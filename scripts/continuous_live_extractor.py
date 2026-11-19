"""
Continuous Autonomous Ingestion & Direct Parity Promotion Engine
Extracts questions from pending exam PDFs, validates text arrangement and formatting,
runs AIR-1 Blind Solver parity, and pushes ONLY 100% matched & verified questions
directly into the live Neon database (completed_questions).
"""

from __future__ import annotations
import os
import re
import sys
import time
import json
import uuid
import datetime
from pathlib import Path
from dotenv import load_dotenv

# Ensure root .env is loaded
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")
sys.path.insert(0, str(ROOT_DIR))

from apps.api.db import get_db_cursor
from engines.ingestion.pdf_extractor import PDFQuestionExtractor
from engines.ingestion.guardrails import validate_question_guardrails
from engines.ingestion.curriculum_engine import CurriculumEngine
from engines.ingestion.blind_solver import BlindSolver
from engines.ingestion.format_normalizer import format_and_arrange_question

def run_continuous_ingestion(max_pdfs: int = 1000, pages_per_pdf: int = 4):
    print("=" * 70)
    print("STARTING CONTINUOUS INGESTION & AUTO-PROMOTION ENGINE")
    print("Direct Push Rule: ONLY 100% Blind Solver MATCHED + Clean Format")
    print(f"Target PDFs: {max_pdfs} | Pages per PDF: {pages_per_pdf}")
    print("=" * 70)

    extractor = PDFQuestionExtractor()
    classifier = CurriculumEngine()
    solver = BlindSolver()

    processed_pdfs = 0

    while processed_pdfs < max_pdfs:
        # Fetch next pending PDF
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT id, pdf_filename, pdf_path, subject, chapter_guess
                FROM public.pdf_ingestion_manifest
                WHERE status = 'PENDING'
                ORDER BY id ASC
                LIMIT 1;
            """)
            target = cur.fetchone()

        if not target:
            print("\n[INFO] No more pending PDFs found in manifest. Sleeping 30s...")
            time.sleep(30)
            continue

        pdf_id = target["id"]
        filename = target["pdf_filename"]
        pdf_path = target["pdf_path"]
        subject_hint = target["subject"]
        chapter_hint = target["chapter_guess"]

        if not os.path.isfile(pdf_path):
            print(f"[WARN] PDF file not found on disk: {pdf_path}. Marking as FAILED.")
            with get_db_cursor() as cur:
                cur.execute("UPDATE public.pdf_ingestion_manifest SET status = 'FAILED' WHERE id = %s;", (pdf_id,))
            continue

        print(f"\n>>> [{processed_pdfs + 1}/{max_pdfs}] INGESTING: {filename}")
        print(f"    Subject: {subject_hint} | Guess: {chapter_hint}")

        # Mark IN_PROGRESS
        with get_db_cursor() as cur:
            cur.execute("""
                UPDATE public.pdf_ingestion_manifest
                SET status = 'IN_PROGRESS', started_at = NOW()
                WHERE id = %s;
            """, (pdf_id,))

        pdf_extracted = 0
        pdf_promoted = 0
        pdf_discrepancies = 0
        pdf_rejected = 0
        pdf_tokens = 0

        try:
            for raw_q in extractor.extract_from_pdf(pdf_path, max_pages=pages_per_pdf):
                pdf_extracted += 1
                q_tokens = raw_q.get("tokens_used", {}).get("total", 0)
                pdf_tokens += q_tokens

                raw_stem = raw_q.get("question_text_latex", "")
                raw_opts = raw_q.get("options", [])
                correct_opt = raw_q.get("correct_option")
                q_type = raw_q.get("question_type", "SINGLE_CHOICE")
                has_diag = raw_q.get("has_diagram", False)
                diag_key = raw_q.get("diagram_s3_key")
                page_num = raw_q.get("page_number", 1)

                # Safe numeric parsing
                clean_num_target = None
                raw_num = raw_q.get("numerical_target")
                if raw_num is not None:
                    try:
                        extracted_digits = re.sub(r'[^0-9\.\-]', '', str(raw_num))
                        clean_num_target = float(extracted_digits) if extracted_digits else None
                    except (ValueError, TypeError):
                        clean_num_target = None

                # 1. TEXT ARRANGEMENT & LAYOUT NORMALIZATION
                clean_stem, fmt_opts, fmt_valid, fmt_notes = format_and_arrange_question(
                    stem=raw_stem,
                    options=raw_opts,
                    question_type=q_type
                )

                # 2. ACADEMIC GUARDRAILS
                is_valid, flaws = validate_question_guardrails(
                    stem=clean_stem,
                    options=fmt_opts,
                    has_diagram=has_diag,
                    diagram_s3_key=diag_key,
                    question_type=q_type
                )

                if not fmt_valid:
                    is_valid = False
                    flaws.extend(fmt_notes)

                guardrail_status = "PASSED" if is_valid else "REJECTED"

                # 3. CURRICULUM CLASSIFICATION
                class_res = classifier.categorize_question(
                    stem=clean_stem,
                    options=fmt_opts,
                    subject_hint=subject_hint,
                    chapter_hint=chapter_hint
                )
                pdf_tokens += class_res.get("tokens_used", {}).get("total", 0)

                # 4. AIR-1 BLIND SOLVER PARITY ARBITER
                solver_status = "SKIPPED"
                solver_opt = None
                solver_reasoning = ""

                if is_valid and correct_opt:
                    solve_res = solver.solve_blind(
                        stem=clean_stem,
                        options=[o["text"] for o in fmt_opts],
                        question_type=q_type,
                        extracted_answer=correct_opt
                    )
                    solver_status = solve_res.get("solver_status", "SKIPPED")
                    solver_opt = solve_res.get("solver_option")
                    solver_reasoning = solve_res.get("reasoning", "")
                    pdf_tokens += solve_res.get("tokens_used", {}).get("total", 0)

                # 5. PARITY & QUALITY GATE
                staging_uid = f"stg_{uuid.uuid4().hex[:12]}"
                auto_promote = (guardrail_status == "PASSED" and solver_status == "MATCHED")

                review_status = "APPROVED" if auto_promote else ("PENDING_REVIEW" if guardrail_status == "PASSED" else "REJECTED")

                # Store into staged_questions
                with get_db_cursor() as cur:
                    cur.execute("""
                        INSERT INTO public.staged_questions (
                            staging_uid, source_pdf, page_number,
                            subject, unit_code, chapter_name, primary_topic_code, topic_name,
                            question_type, question_text_latex, options, correct_option,
                            numerical_target, solution_text_latex, has_diagram, diagram_s3_key,
                            guardrail_status, guardrail_notes,
                            solver_status, solver_option, solver_reasoning,
                            review_status, total_tokens, model_name
                        ) VALUES (
                            %s, %s, %s,
                            %s, %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s,
                            %s, %s, %s,
                            %s, %s, %s
                        ) RETURNING id;
                    """, (
                        staging_uid, filename, page_num,
                        class_res["subject"], class_res["unit_code"], class_res["chapter_name"],
                        class_res["primary_topic_code"], class_res["topic_name"],
                        q_type, clean_stem, json.dumps(fmt_opts), correct_opt,
                        clean_num_target, raw_q.get("solution_text_latex", ""),
                        has_diag, diag_key,
                        guardrail_status, json.dumps(flaws),
                        solver_status, solver_opt, solver_reasoning,
                        "PROMOTED" if auto_promote else review_status,
                        q_tokens, "qwen3.8-27b + blind_solver"
                    ))
                    stg_id = cur.fetchone()["id"]

                    # 6. DIRECT PROMOTION TO NEON LIVE DATABASE
                    if auto_promote:
                        new_uid = f"pyq_{staging_uid}"
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
                                jsonb_build_array('AUTO_PARITY_PROMOTED', 'SOURCE_PDF: ' || %s)
                            )
                            ON CONFLICT (question_uid) DO NOTHING;
                        """, (
                            new_uid, class_res["subject"], class_res["unit_code"], class_res["chapter_name"],
                            class_res["primary_topic_code"], q_type, clean_stem, json.dumps(fmt_opts),
                            correct_opt, clean_num_target,
                            solver_reasoning or raw_q.get("solution_text_latex", ""),
                            has_diag, diag_key, filename
                        ))
                        pdf_promoted += 1
                        print(f"  [PROMOTED ✓] Q{pdf_extracted}: Match! Key={correct_opt} == Solver={solver_opt} -> {class_res['primary_topic_code']}")
                    elif solver_status == "DISCREPANCY":
                        pdf_discrepancies += 1
                        print(f"  [HELD ⚠] Q{pdf_extracted}: Discrepancy! Key={correct_opt} vs Solver={solver_opt}. Kept in Staging.")
                    else:
                        pdf_rejected += 1
                        print(f"  [REJECTED ✕] Q{pdf_extracted}: Guardrails failed: {flaws[:1]}")

            # Mark Manifest COMPLETED
            with get_db_cursor() as cur:
                cur.execute("""
                    UPDATE public.pdf_ingestion_manifest
                    SET status = 'COMPLETED',
                        extracted_questions = %s,
                        passed_guardrails = %s,
                        rejected_guardrails = %s,
                        total_tokens_used = %s,
                        completed_at = NOW()
                    WHERE id = %s;
                """, (pdf_extracted, pdf_promoted, pdf_rejected, pdf_tokens, pdf_id))

            print(f"--> Finished {filename}: {pdf_extracted} extracted | {pdf_promoted} DIRECTLY PROMOTED TO NEON | {pdf_discrepancies} held for review.")

        except Exception as e:
            print(f"[ERROR] Ingestion failed for {filename}: {e}")
            with get_db_cursor() as cur:
                cur.execute("UPDATE public.pdf_ingestion_manifest SET status = 'FAILED', error_message = %s WHERE id = %s;", (str(e), pdf_id))

        processed_pdfs += 1
        time.sleep(2)

if __name__ == "__main__":
    run_continuous_ingestion()
