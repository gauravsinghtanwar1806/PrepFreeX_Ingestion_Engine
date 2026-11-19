"""
Staging & Verification API Router
Allows inspecting, approving, rejecting, and promoting staged questions from the new ingestion pipeline.
"""

from __future__ import annotations
import json
import uuid
from typing import Optional, Any, List
from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel
from apps.api.db import get_db_cursor
from engines.ingestion.safe_ingestor import SafeIngestionPipeline
from engines.ingestion.full_test_ingestor import FullTestIngestor

router = APIRouter(prefix="/api/v1/staging", tags=["Staging & Ingestion Review"])

class UpdateStatusRequest(BaseModel):
    notes: Optional[str] = None

class SetAnswerRequest(BaseModel):
    correct_option: str
    auto_approve: bool = True

class IngestNextRequest(BaseModel):
    subject: Optional[str] = None
    pdf_path: Optional[str] = None
    max_pages: Optional[int] = 2
    no_solver: bool = False

class EditDatabaseQuestionRequest(BaseModel):
    question_text_latex: Optional[str] = None
    options: Optional[list[Any]] = None
    correct_option: Optional[str] = None
    numerical_target: Optional[float] = None
    solution_text_latex: Optional[str] = None
    subject: Optional[str] = None
    unit_code: Optional[str] = None
    chapter_name: Optional[str] = None

EditDatabaseQuestionRequest.model_rebuild()

@router.get("/summary")
def get_staging_summary():
    """Returns top-level KPIs of the ingestion pipeline."""
    with get_db_cursor() as cur:
        # Questions KPIs
        cur.execute("""
            SELECT 
                COUNT(*) as total_staged,
                COUNT(*) FILTER (WHERE review_status = 'APPROVED') as approved,
                COUNT(*) FILTER (WHERE review_status = 'PENDING_REVIEW') as pending_review,
                COUNT(*) FILTER (WHERE review_status = 'REJECTED') as rejected,
                COUNT(*) FILTER (WHERE review_status = 'PROMOTED') as promoted,
                COALESCE(SUM(total_tokens), 0) as total_tokens_used
            FROM public.staged_questions;
        """)
        q_stats = cur.fetchone()

        # PDF Manifest KPIs
        cur.execute("""
            SELECT 
                COUNT(*) as total_pdfs,
                COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed_pdfs,
                COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as in_progress_pdfs,
                COUNT(*) FILTER (WHERE status = 'PENDING') as pending_pdfs,
                COUNT(*) FILTER (WHERE status = 'FAILED') as failed_pdfs
            FROM public.pdf_ingestion_manifest;
        """)
        pdf_stats = cur.fetchone()

    return {
        "questions": q_stats,
        "manifest": pdf_stats
    }

@router.post("/ingest-next")
def ingest_next_pdf(req: Optional[IngestNextRequest] = None):
    """
    Extracts, validates, classifies, and stages questions from the next pending PDF (or specified PDF).
    """
    subject_filter = req.subject.upper() if (req and req.subject) else None
    target_path = req.pdf_path if (req and req.pdf_path) else None
    max_pages = req.max_pages if req else 2
    no_solver = req.no_solver if req else False

    with get_db_cursor() as cur:
        if target_path:
            cur.execute("""
                SELECT pdf_path, subject, chapter_guess
                FROM public.pdf_ingestion_manifest
                WHERE pdf_path = %s;
            """, (target_path,))
        elif subject_filter:
            cur.execute("""
                SELECT pdf_path, subject, chapter_guess
                FROM public.pdf_ingestion_manifest
                WHERE status = 'PENDING' AND subject = %s
                ORDER BY id ASC
                LIMIT 1;
            """, (subject_filter,))
        else:
            cur.execute("""
                SELECT pdf_path, subject, chapter_guess
                FROM public.pdf_ingestion_manifest
                WHERE status = 'PENDING' AND subject IN ('PHYSICS', 'CHEMISTRY', 'MATHEMATICS')
                ORDER BY id ASC
                LIMIT 1;
            """)
        target = cur.fetchone()

    if not target:
        raise HTTPException(status_code=404, detail="No pending PDFs found matching the criteria.")

    is_full_test = (
        "Question Paper with Answer Key.pdf" in target["pdf_path"] or
        "full_tests" in target["pdf_path"] or
        target.get("subject") == "FULL_TEST" or
        subject_filter == "FULL_TEST"
    )

    if is_full_test:
        full_ingestor = FullTestIngestor()
        metrics = full_ingestor.ingest_full_test(
            pdf_path=target["pdf_path"],
            limit_questions=15,
            auto_promote_matched=True
        )
        return {
            "status": "SUCCESS",
            "message": f"Successfully ingested full test {metrics['pdf_filename']}! ({metrics['total_extracted']} extracted, {metrics['passed_guardrails']} passed guardrails, {metrics['solver_matched']} verified by blind solver, {metrics['auto_promoted']} auto-promoted).",
            "metrics": metrics
        }

    pipeline = SafeIngestionPipeline()
    metrics = pipeline.process_pdf(
        pdf_path=target["pdf_path"],
        subject_hint=target["subject"],
        chapter_hint=target["chapter_guess"],
        max_pages=max_pages,
        run_solver=not no_solver
    )

    return {
        "status": "SUCCESS",
        "message": f"Successfully extracted from {metrics['pdf_filename']}! ({metrics['total_extracted']} questions extracted, {metrics['passed_guardrails']} passed guardrails, {metrics['solver_matched']} matched blind solver).",
        "metrics": metrics
    }

@router.get("/manifest")
def list_manifest(
    status: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    """Lists ingested and pending PDFs."""
    query = "SELECT * FROM public.pdf_ingestion_manifest WHERE 1=1"
    params = []

    if status:
        query += " AND status = %s"
        params.append(status)
    if subject:
        query += " AND subject = %s"
        params.append(subject.upper())

    query += " ORDER BY id ASC LIMIT %s OFFSET %s;"
    params.extend([limit, offset])

    with get_db_cursor() as cur:
        cur.execute(query, tuple(params))
        rows = cur.fetchall()

    return {"pdfs": rows}

@router.get("/questions")
def list_staged_questions(
    review_status: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0)
):
    """Lists staged questions with guardrail logs and solver arbitration results."""
    query = "SELECT * FROM public.staged_questions WHERE 1=1"
    params = []

    if review_status:
        query += " AND review_status = %s"
        params.append(review_status.upper())
    if subject:
        query += " AND subject = %s"
        params.append(subject.upper())

    query += " ORDER BY id DESC LIMIT %s OFFSET %s;"
    params.extend([limit, offset])

    with get_db_cursor() as cur:
        cur.execute(query, tuple(params))
        rows = cur.fetchall()

    return {"questions": rows}

@router.patch("/questions/{question_id}/answer")
def set_question_answer(question_id: int, req: SetAnswerRequest):
    """Sets the correct option manually from the UI and updates solver status."""
    new_opt = req.correct_option.strip().upper()
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM public.staged_questions WHERE id = %s;", (question_id,))
        q = cur.fetchone()
        if not q:
            raise HTTPException(status_code=404, detail="Staged question not found")

        solver_opt = (q["solver_option"] or "").strip().upper()
        solver_status = "MATCHED" if new_opt == solver_opt else "DISCREPANCY"
        new_review = "APPROVED" if (req.auto_approve and q["guardrail_status"] == "PASSED") else q["review_status"]

        cur.execute("""
            UPDATE public.staged_questions
            SET correct_option = %s,
                solver_status = %s,
                review_status = %s,
                reviewed_at = NOW()
            WHERE id = %s
            RETURNING *;
        """, (new_opt, solver_status, new_review, question_id))
        updated = cur.fetchone()

    return {"status": "SUCCESS", "message": f"Answer for question {question_id} set to {new_opt}.", "question": updated}

@router.post("/questions/{question_id}/approve")
def approve_question(question_id: int):
    """Marks a staged question as APPROVED for production."""
    with get_db_cursor() as cur:
        cur.execute("""
            UPDATE public.staged_questions
            SET review_status = 'APPROVED', reviewed_at = NOW()
            WHERE id = %s RETURNING id;
        """, (question_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Staged question not found")

    return {"status": "SUCCESS", "message": f"Question {question_id} approved."}

@router.post("/questions/{question_id}/reject")
def reject_question(question_id: int, req: Optional[UpdateStatusRequest] = None):
    """Marks a staged question as REJECTED."""
    with get_db_cursor() as cur:
        cur.execute("""
            UPDATE public.staged_questions
            SET review_status = 'REJECTED', reviewed_at = NOW()
            WHERE id = %s RETURNING id;
        """, (question_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Staged question not found")

    return {"status": "SUCCESS", "message": f"Question {question_id} rejected."}

@router.post("/promote")
def promote_approved_to_production():
    """
    Promotes all 'APPROVED' questions from staged_questions into completed_questions
    with assessment_status = 'ELIGIBLE' and academic_status = 'MODEL_REVIEWED'.
    """
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT * FROM public.staged_questions
            WHERE review_status = 'APPROVED';
        """)
        approved_rows = cur.fetchall()

        if not approved_rows:
            return {"promoted_count": 0, "message": "No approved questions to promote."}

        promoted_count = 0
        for r in approved_rows:
            new_uid = f"pyq_staged_{r['staging_uid']}"
            cur.execute("""
                INSERT INTO public.completed_questions (
                    question_uid, subject, unit_code, chapter_name, primary_topic_code,
                    question_type, question_text_latex, options, correct_option, numerical_target,
                    solution_text_latex, has_diagram, diagram_s3_key,
                    assessment_status, academic_status, tags
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    'ELIGIBLE', 'MODEL_REVIEWED',
                    jsonb_build_array('STAGED_PROMOTED', 'SOURCE_PDF: ' || %s)
                )
                ON CONFLICT (question_uid) DO UPDATE
                SET question_text_latex = EXCLUDED.question_text_latex,
                    options = EXCLUDED.options,
                    correct_option = EXCLUDED.correct_option,
                    solution_text_latex = EXCLUDED.solution_text_latex,
                    has_diagram = EXCLUDED.has_diagram,
                    diagram_s3_key = EXCLUDED.diagram_s3_key,
                    assessment_status = 'ELIGIBLE',
                    academic_status = 'MODEL_REVIEWED',
                    tags = EXCLUDED.tags;
            """, (
                new_uid, r["subject"], r["unit_code"], r["chapter_name"], r["primary_topic_code"],
                r["question_type"], r["question_text_latex"], json.dumps(r["options"]) if isinstance(r["options"], list) else r["options"],
                r["correct_option"], r["numerical_target"],
                r["solution_text_latex"], r["has_diagram"], r["diagram_s3_key"],
                r["source_pdf"]
            ))

            # Update staging row status
            cur.execute("""
                UPDATE public.staged_questions
                SET review_status = 'PROMOTED', promoted_at = NOW()
                WHERE id = %s;
            """, (r["id"],))
            promoted_count += 1

    return {
        "status": "SUCCESS",
        "promoted_count": promoted_count,
        "message": f"Successfully promoted {promoted_count} verified questions into active student question bank!"
    }

@router.get("/database-taxonomy")
def get_database_taxonomy(subject: Optional[str] = None):
    """
    Returns hierarchical units and subtopics present in completed_questions
    with question counts.
    """
    base_where = "WHERE cq.assessment_status = 'ELIGIBLE'"
    params = []
    if subject and subject.upper() != "ALL":
        base_where += " AND cq.subject = %s"
        params.append(subject.upper())

    with get_db_cursor() as cur:
        cur.execute(f"""
            SELECT 
                cq.subject,
                cq.unit_code,
                COALESCE(u.unit_title, cq.chapter_name) as unit_title,
                cq.primary_topic_code,
                COALESCE(t.topic_name, cq.primary_topic_code) as topic_name,
                count(*) as q_count
            FROM public.completed_questions cq
            LEFT JOIN public.syllabus_units u ON cq.unit_code = u.unit_code
            LEFT JOIN public.chapter_topics t ON cq.primary_topic_code = t.topic_code
            {base_where}
            GROUP BY cq.subject, cq.unit_code, u.unit_title, cq.chapter_name, cq.primary_topic_code, t.topic_name
            ORDER BY cq.subject, cq.unit_code, cq.primary_topic_code;
        """, tuple(params))
        rows = cur.fetchall()

    units_map = {}
    for r in rows:
        u_code = r["unit_code"] or "OTHER"
        if u_code not in units_map:
            units_map[u_code] = {
                "unit_code": u_code,
                "unit_title": r["unit_title"] or u_code,
                "subject": r["subject"],
                "total_questions": 0,
                "topics": []
            }
        units_map[u_code]["total_questions"] += r["q_count"]
        if r["primary_topic_code"]:
            units_map[u_code]["topics"].append({
                "topic_code": r["primary_topic_code"],
                "topic_name": r["topic_name"] or r["primary_topic_code"],
                "q_count": r["q_count"]
            })

    return {
        "units": list(units_map.values())
    }

@router.get("/database-questions")
def list_database_questions(
    subject: Optional[str] = Query(None),
    unit_code: Optional[str] = Query(None),
    topic_code: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    verified_status: Optional[str] = Query("UNVERIFIED"),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0)
):
    """
    Fetches live questions from public.completed_questions for interactive test review and manual pruning.
    Enforces assessment_status = 'ELIGIBLE'.
    By default filters to UNVERIFIED questions so verified questions are hidden from the review test queue.
    """
    base_where = "WHERE assessment_status = 'ELIGIBLE'"
    params = []

    if verified_status == "UNVERIFIED":
        base_where += " AND (academic_status != 'HUMAN_VERIFIED' OR academic_status IS NULL)"
    elif verified_status == "VERIFIED":
        base_where += " AND academic_status = 'HUMAN_VERIFIED'"

    if subject and subject.upper() != "ALL":
        base_where += " AND subject = %s"
        params.append(subject.upper())
    if unit_code and unit_code.upper() != "ALL":
        base_where += " AND unit_code = %s"
        params.append(unit_code.upper())
    if topic_code and topic_code.upper() != "ALL":
        base_where += " AND primary_topic_code = %s"
        params.append(topic_code.upper())
    if search:
        base_where += " AND (question_text_latex ILIKE %s OR question_uid ILIKE %s OR chapter_name ILIKE %s)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])

    with get_db_cursor() as cur:
        cur.execute(f"SELECT count(*) FROM public.completed_questions {base_where};", tuple(params))
        total_count = cur.fetchone()["count"]

        # Also get unverified vs verified counts for top-level counters
        cur.execute("""
            SELECT 
                COUNT(*) FILTER (WHERE assessment_status = 'ELIGIBLE' AND (academic_status != 'HUMAN_VERIFIED' OR academic_status IS NULL)) as unverified,
                COUNT(*) FILTER (WHERE assessment_status = 'ELIGIBLE' AND academic_status = 'HUMAN_VERIFIED') as verified,
                COUNT(*) FILTER (WHERE assessment_status = 'ELIGIBLE') as total
            FROM public.completed_questions;
        """)
        counts_row = cur.fetchone()

        query = f"""
            SELECT id, question_uid, subject, unit_code, chapter_name, primary_topic_code,
                   question_type, question_text_latex, options, correct_option, numerical_target,
                   solution_text_latex, has_diagram, diagram_s3_key, difficulty_tier, source_pdf,
                   academic_status
            FROM public.completed_questions
            {base_where}
            ORDER BY id ASC
            LIMIT %s OFFSET %s;
        """
        cur.execute(query, tuple(params + [limit, offset]))
        rows = cur.fetchall()

    return {
        "total": total_count,
        "counts": counts_row,
        "limit": limit,
        "offset": offset,
        "questions": rows
    }

@router.post("/database-questions/{question_uid}/verify")
def verify_database_question(question_uid: str):
    """
    Marks a database question as HUMAN_VERIFIED.
    Immediately removes it from the unverified review queue.
    """
    with get_db_cursor() as cur:
        cur.execute("""
            UPDATE public.completed_questions
            SET academic_status = 'HUMAN_VERIFIED',
                answer_status = 'HUMAN_VERIFIED'
            WHERE question_uid = %s
            RETURNING id, question_uid, subject, chapter_name, academic_status;
        """, (question_uid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Question not found in database.")

    return {
        "status": "SUCCESS",
        "message": f"Question {question_uid} marked as HUMAN_VERIFIED!",
        "question": row
    }

@router.patch("/database-questions/{question_uid}")
def edit_database_question(question_uid: str, req: dict = Body(...)):
    """
    Edits a database question's stem, options, correct option, or solution directly.
    Automatically marks the updated question as HUMAN_VERIFIED.
    """
    updates = []
    params = []
    if req.get("question_text_latex") is not None:
        updates.append("question_text_latex = %s")
        params.append(req["question_text_latex"])
    if req.get("options") is not None:
        updates.append("options = %s")
        params.append(json.dumps(req["options"]) if not isinstance(req["options"], str) else req["options"])
    if req.get("correct_option") is not None:
        updates.append("correct_option = %s")
        params.append(str(req["correct_option"]).strip().upper())
    if req.get("numerical_target") is not None:
        updates.append("numerical_target = %s")
        params.append(req["numerical_target"])
    if req.get("solution_text_latex") is not None:
        updates.append("solution_text_latex = %s")
        params.append(req["solution_text_latex"])
    if req.get("subject") is not None:
        updates.append("subject = %s")
        params.append(str(req["subject"]).strip().upper())
    if req.get("unit_code") is not None:
        updates.append("unit_code = %s")
        params.append(str(req["unit_code"]).strip().upper())
    if req.get("chapter_name") is not None:
        updates.append("chapter_name = %s")
        params.append(str(req["chapter_name"]).strip())

    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided for update.")

    updates.append("academic_status = 'HUMAN_VERIFIED'")
    params.append(question_uid)
    set_clause = ", ".join(updates)

    with get_db_cursor() as cur:
        cur.execute(f"""
            UPDATE public.completed_questions
            SET {set_clause}
            WHERE question_uid = %s
            RETURNING id, question_uid, subject, unit_code, chapter_name, primary_topic_code,
                      question_type, question_text_latex, options, correct_option, numerical_target,
                      solution_text_latex, has_diagram, diagram_s3_key, difficulty_tier, source_pdf,
                      academic_status;
        """, tuple(params))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Question not found in database.")

    return {
        "status": "SUCCESS",
        "message": f"Question {question_uid} successfully updated and marked as HUMAN_VERIFIED!",
        "question": row
    }

@router.delete("/database-questions/{question_uid}")
def remove_database_question(question_uid: str):
    """
    Removes a bad or defective question from the live database pool by quarantining it.
    Immediately excludes it from all tests, assessments, and public queries.
    """
    with get_db_cursor() as cur:
        cur.execute("""
            UPDATE public.completed_questions
            SET assessment_status = 'QUARANTINED',
                academic_status = 'QUARANTINED_BY_REVIEWER'
            WHERE question_uid = %s
            RETURNING id, question_uid, subject, chapter_name;
        """, (question_uid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Question not found in database.")

    return {
        "status": "SUCCESS",
        "message": f"Successfully removed question {question_uid} from active database!",
        "removed_question": row
    }


