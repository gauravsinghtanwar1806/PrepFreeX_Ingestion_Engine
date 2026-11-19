'use client';

import React, { useState, useEffect } from 'react';
import katex from 'katex';
import { 
  CheckCircle2, XCircle, AlertTriangle, ArrowUpRight, RefreshCw, 
  Layers, FileText, Cpu, Check, X, Eye, ChevronDown, ChevronRight, Zap,
  Trash2, Search, BookOpen, ChevronLeft, Edit3, Save, RotateCcw, Filter
} from 'lucide-react';

function MathSpan({ text }: { text: string }) {
  if (!text) return null;
  // Simple LaTeX rendering helper
  const parts = text.split(/(\$[^\$]+\$)/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, idx) => {
        if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
          const rawMath = part.slice(1, -1);
          try {
            const html = katex.renderToString(rawMath, { throwOnError: false, displayMode: false });
            return <span key={idx} dangerouslySetInnerHTML={{ __html: html }} className="inline-katex px-0.5" />;
          } catch (e) {
            return <code key={idx} className="text-violet-600 bg-slate-100 px-1 rounded">{part}</code>;
          }
        }
        return <span key={idx}>{part}</span>;
      })}
    </span>
  );
}

export function StagingReviewView() {
  const [summary, setSummary] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [manifest, setManifest] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [activeTab, setActiveTab] = useState<'questions' | 'manifest' | 'database_test'>('questions');
  const [loading, setLoading] = useState<boolean>(true);
  const [promoting, setPromoting] = useState<boolean>(false);
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null);
  const [extracting, setExtracting] = useState<boolean>(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<number, boolean>>({});

  // Live Database Test & Prune State
  const [dbQuestions, setDbQuestions] = useState<any[]>([]);
  const [dbTotal, setDbTotal] = useState<number>(0);
  const [dbCounts, setDbCounts] = useState<{ unverified: number; verified: number; total: number }>({ unverified: 0, verified: 0, total: 0 });
  const [dbLoading, setDbLoading] = useState<boolean>(false);
  const [dbSubject, setDbSubject] = useState<string>('ALL');
  const [dbUnit, setDbUnit] = useState<string>('ALL');
  const [dbTopic, setDbTopic] = useState<string>('ALL');
  const [dbTaxonomy, setDbTaxonomy] = useState<any[]>([]);
  const [dbVerifiedStatus, setDbVerifiedStatus] = useState<'UNVERIFIED' | 'VERIFIED' | 'ALL'>('UNVERIFIED');
  const [dbSearch, setDbSearch] = useState<string>('');
  const [dbPage, setDbPage] = useState<number>(0);
  const [dbLimit] = useState<number>(20);
  const [dbDeleteMsg, setDbDeleteMsg] = useState<string | null>(null);
  const [dbUserAnswers, setDbUserAnswers] = useState<Record<string, string>>({});
  const [dbExpandedSolution, setDbExpandedSolution] = useState<Record<string, boolean>>({});
  const [dbRevealedAnswers, setDbRevealedAnswers] = useState<Record<string, boolean>>({});

  // Question Inline Editing State
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editStem, setEditStem] = useState<string>('');
  const [editOptions, setEditOptions] = useState<string[]>(['', '', '', '']);
  const [editCorrectOption, setEditCorrectOption] = useState<string>('A');
  const [editSolution, setEditSolution] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const fetchDbTaxonomy = async (subject = dbSubject) => {
    try {
      let url = 'http://127.0.0.1:8000/api/v1/staging/database-taxonomy';
      if (subject !== 'ALL') url += `?subject=${encodeURIComponent(subject)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDbTaxonomy(data.units || []);
      }
    } catch (err) {
      console.error('Failed to load taxonomy:', err);
    }
  };

  const fetchDbQuestions = async (
    page = dbPage, 
    subject = dbSubject, 
    unit = dbUnit, 
    topic = dbTopic, 
    search = dbSearch, 
    vStatus = dbVerifiedStatus
  ) => {
    setDbLoading(true);
    try {
      let url = `http://127.0.0.1:8000/api/v1/staging/database-questions?limit=${dbLimit}&offset=${page * dbLimit}&verified_status=${vStatus}`;
      if (subject !== 'ALL') url += `&subject=${encodeURIComponent(subject)}`;
      if (unit !== 'ALL') url += `&unit_code=${encodeURIComponent(unit)}`;
      if (topic !== 'ALL') url += `&topic_code=${encodeURIComponent(topic)}`;
      if (search.trim()) url += `&search=${encodeURIComponent(search.trim())}`;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDbQuestions(data.questions || []);
        setDbTotal(data.total || 0);
        if (data.counts) {
          setDbCounts({
            unverified: Number(data.counts.unverified || 0),
            verified: Number(data.counts.verified || 0),
            total: Number(data.counts.total || 0),
          });
        }
      }
    } catch (err) {
      console.error('Failed to load database questions:', err);
    } finally {
      setDbLoading(false);
    }
  };

  const handleStartEdit = (q: any) => {
    setEditingUid(q.question_uid);
    setEditStem(q.question_text_latex || '');
    const opts = Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? JSON.parse(q.options || '[]') : []);
    const optTexts = [0, 1, 2, 3].map(i => {
      const o = opts[i];
      return typeof o === 'string' ? o : (o?.text || '');
    });
    setEditOptions(optTexts);
    setEditCorrectOption((q.correct_option || 'A').trim().toUpperCase());
    setEditSolution(q.solution_text_latex || '');
  };

  const handleSaveEdit = async (question_uid: string) => {
    setSavingEdit(true);
    try {
      const formattedOptions = editOptions.map(t => ({ text: t }));
      const res = await fetch(`http://127.0.0.1:8000/api/v1/staging/database-questions/${encodeURIComponent(question_uid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_text_latex: editStem,
          options: formattedOptions,
          correct_option: editCorrectOption,
          solution_text_latex: editSolution
        })
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.question;
        setDbQuestions(prev => prev.map(q => q.question_uid === question_uid ? { ...q, ...updated } : q));
        setEditingUid(null);
        setDbDeleteMsg(`Question updated successfully and marked as verified.`);
        setTimeout(() => setDbDeleteMsg(null), 5000);
      } else {
        alert('Failed to save question edits.');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving edits.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleVerifyDbQuestion = async (question_uid: string, qid: number) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/staging/database-questions/${encodeURIComponent(question_uid)}/verify`, {
        method: 'POST'
      });
      if (res.ok) {
        if (dbVerifiedStatus === 'UNVERIFIED') {
          // Immediately hide verified question so it is never seen again in this unverified test review queue
          setDbQuestions(prev => prev.filter(q => q.question_uid !== question_uid));
          setDbTotal(prev => Math.max(0, prev - 1));
        } else {
          setDbQuestions(prev => prev.map(q => q.question_uid === question_uid ? { ...q, academic_status: 'HUMAN_VERIFIED' } : q));
        }
        setDbCounts(prev => ({
          ...prev,
          unverified: Math.max(0, prev.unverified - 1),
          verified: prev.verified + 1
        }));
        setDbDeleteMsg(`Question #${qid} verified and cleared from review queue!`);
        setTimeout(() => setDbDeleteMsg(null), 5000);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveDbQuestion = async (question_uid: string, qid: number) => {
    if (!window.confirm(`Are you sure you want to remove Question #${qid} from the live database?\n\nThis will immediately eliminate it from all tests and assessments.`)) {
      return;
    }

    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/staging/database-questions/${encodeURIComponent(question_uid)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setDbQuestions(prev => prev.filter(q => q.question_uid !== question_uid));
        setDbTotal(prev => Math.max(0, prev - 1));
        setDbDeleteMsg(`Question #${qid} (${question_uid.slice(0, 16)}...) was permanently removed from the active database.`);
        setTimeout(() => setDbDeleteMsg(null), 6000);
      } else {
        alert('Failed to remove question from database.');
      }
    } catch (err) {
      console.error('Failed to remove question:', err);
      alert('Network error while attempting to remove question.');
    }
  };

  const handleExtractNext = async (pdfPath?: string) => {
    setExtracting(true);
    setExtractMsg(null);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/v1/staging/ingest-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pdfPath ? { pdf_path: pdfPath, max_pages: 2 } : { max_pages: 2 })
      });
      if (res.ok) {
        const data = await res.json();
        setExtractMsg(data.message || 'Extracted new questions successfully.');
        setActiveTab('questions');
        fetchData();
      } else {
        const err = await res.json();
        setExtractMsg(err.detail || 'Failed to extract questions.');
      }
    } catch (err) {
      setExtractMsg('Network error while running extraction pipeline.');
    } finally {
      setExtracting(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const sumRes = await fetch('http://127.0.0.1:8000/api/v1/staging/summary');
      if (sumRes.ok) setSummary(await sumRes.json());

      let qUrl = 'http://127.0.0.1:8000/api/v1/staging/questions?limit=100';
      if (filterStatus !== 'ALL') qUrl += `&review_status=${filterStatus}`;
      const qRes = await fetch(qUrl);
      if (qRes.ok) {
        const qData = await qRes.json();
        setQuestions(qData.questions || []);
      }

      const mRes = await fetch('http://127.0.0.1:8000/api/v1/staging/manifest?limit=50');
      if (mRes.ok) {
        const mData = await mRes.json();
        setManifest(mData.pdfs || []);
      }
    } catch (err) {
      console.error('Failed to load staging data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filterStatus]);

  useEffect(() => {
    if (activeTab === 'database_test') {
      fetchDbTaxonomy(dbSubject);
      fetchDbQuestions(dbPage, dbSubject, dbUnit, dbTopic, dbSearch, dbVerifiedStatus);
    }
  }, [activeTab, dbPage, dbSubject, dbUnit, dbTopic, dbVerifiedStatus]);

  const handleApprove = async (qid: number) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/staging/questions/${qid}/approve`, { method: 'POST' });
      if (res.ok) {
        setQuestions(prev => prev.map(q => q.id === qid ? { ...q, review_status: 'APPROVED' } : q));
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleReject = async (qid: number) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/staging/questions/${qid}/reject`, { method: 'POST' });
      if (res.ok) {
        setQuestions(prev => prev.map(q => q.id === qid ? { ...q, review_status: 'REJECTED' } : q));
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectAnswer = async (qid: number, optLabel: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/staging/questions/${qid}/answer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct_option: optLabel, auto_approve: true })
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.question;
        setQuestions(prev => prev.map(q => q.id === qid ? {
          ...q,
          correct_option: updated.correct_option,
          solver_status: updated.solver_status,
          review_status: updated.review_status
        } : q));
        fetchData();
      }
    } catch (err) {
      console.error('Failed to update answer:', err);
    }
  };

  const handlePromoteAll = async () => {
    setPromoting(true);
    setPromoteMsg(null);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/v1/staging/promote', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setPromoteMsg(data.message || `Promoted ${data.promoted_count} questions.`);
        fetchData();
      }
    } catch (err) {
      setPromoteMsg('Failed to promote questions.');
    } finally {
      setPromoting(false);
    }
  };

  const toggleReasoning = (id: number) => {
    setExpandedReasoning(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const qStats = summary?.questions || {};
  const mStats = summary?.manifest || {};

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* HEADER & SUMMARY METRICS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Layers className="h-6 w-6 text-indigo-600" />
            Safe Question Ingestion & Staging Review
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Air-gapped verification staging area. Guardrail validation, 3-tier taxonomy, and Blind Solver parity before live database promotion.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => handleExtractNext()}
            disabled={extracting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-all shadow-xs cursor-pointer"
          >
            <Zap className={`h-4 w-4 ${extracting ? 'animate-bounce text-amber-300' : ''}`} />
            {extracting ? 'Extracting & Verifying PDF...' : 'Extract Next Questions from PDF'}
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handlePromoteAll}
            disabled={promoting || (qStats.approved || 0) === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-xs cursor-pointer"
          >
            <ArrowUpRight className="h-4 w-4" />
            {promoting ? 'Promoting...' : `Promote ${qStats.approved || 0} Approved to Live`}
          </button>
        </div>
      </div>

      {extractMsg && (
        <div className="p-4 bg-violet-50 border border-violet-200 text-violet-900 rounded-xl flex items-center justify-between text-sm shadow-2xs">
          <span className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-violet-600 shrink-0" />
            {extractMsg}
          </span>
          <button onClick={() => setExtractMsg(null)} className="text-violet-600 hover:text-violet-900 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {promoteMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between text-sm">
          <span>{promoteMsg}</span>
          <button onClick={() => setPromoteMsg(null)} className="text-emerald-600 hover:text-emerald-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Staged</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{qStats.total_staged || 0}</div>
          <div className="text-xs text-slate-400 mt-1">Across all PDFs</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-200/80 bg-emerald-50/20 shadow-2xs">
          <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Approved</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{qStats.approved || 0}</div>
          <div className="text-xs text-emerald-600/80 mt-1">Parity Verified</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-amber-200/80 bg-amber-50/20 shadow-2xs">
          <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Pending Review</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{qStats.pending_review || 0}</div>
          <div className="text-xs text-amber-600/80 mt-1">Needs human check</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-red-200/80 bg-red-50/20 shadow-2xs">
          <div className="text-xs font-semibold text-red-700 uppercase tracking-wider">Rejected</div>
          <div className="text-2xl font-bold text-red-600 mt-1">{qStats.rejected || 0}</div>
          <div className="text-xs text-red-600/80 mt-1">Guardrail violations</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-indigo-200/80 bg-indigo-50/20 shadow-2xs">
          <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">Promoted Live</div>
          <div className="text-2xl font-bold text-indigo-600 mt-1">{qStats.promoted || 0}</div>
          <div className="text-xs text-indigo-600/80 mt-1">In active DB</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-purple-200/80 bg-purple-50/20 shadow-2xs">
          <div className="text-xs font-semibold text-purple-700 uppercase tracking-wider">Tokens Used</div>
          <div className="text-xl font-bold text-purple-600 mt-1">
            {Number(qStats.total_tokens_used || 0).toLocaleString()}
          </div>
          <div className="text-xs text-purple-600/80 mt-1">Qwen + Solver tokens</div>
        </div>
      </div>

      {/* NAVIGATION TABS */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('questions')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'questions' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Staged Questions ({questions.length})
        </button>
        <button
          onClick={() => setActiveTab('manifest')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'manifest' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          PDF Ingestion Tracker ({mStats.completed_pdfs || 0} / {mStats.total_pdfs || 0} Completed)
        </button>
        <button
          onClick={() => { setActiveTab('database_test'); setDbPage(0); fetchDbQuestions(0, dbSubject, dbUnit, dbTopic, dbSearch, dbVerifiedStatus); }}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
            activeTab === 'database_test' ? 'border-rose-600 text-rose-600 bg-rose-50/40 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen className="h-4 w-4 text-rose-600" />
          Live Database Test & Prune {dbTotal > 0 ? `(${dbTotal})` : ''}
        </button>
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'questions' ? (
        <div className="space-y-4">
          {/* FILTER BAR */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
            {['ALL', 'APPROVED', 'PENDING_REVIEW', 'REJECTED', 'PROMOTED'].map(st => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-3 py-1.5 rounded-full font-medium transition-colors cursor-pointer ${
                  filterStatus === st 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* QUESTIONS LIST */}
          {questions.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200">
              <Layers className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <div className="text-base font-semibold text-slate-700">No staged questions found</div>
              <p className="text-xs text-slate-500 mt-1">
                Run <code className="bg-slate-100 px-1 py-0.5 rounded">python -m scripts.safe_ingest --next-pending</code> in your terminal to ingest from the next pending PDF.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {questions.map((q, idx) => {
                const opts = Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? JSON.parse(q.options || '[]') : []);
                const notes = Array.isArray(q.guardrail_notes) ? q.guardrail_notes : (typeof q.guardrail_notes === 'string' ? JSON.parse(q.guardrail_notes || '[]') : []);
                const hasDiscrepancy = q.solver_status === 'DISCREPANCY';
                const isApproved = q.review_status === 'APPROVED';
                const isRejected = q.review_status === 'REJECTED';
                const isPromoted = q.review_status === 'PROMOTED';

                return (
                  <div key={q.id} className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 transition-all hover:border-slate-300">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                          #{q.id} ({q.staging_uid})
                        </span>
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-semibold rounded">
                          {q.subject}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                          {q.chapter_name}
                        </span>
                        <span className="px-2 py-0.5 bg-violet-50 text-violet-700 font-mono rounded">
                          {q.primary_topic_code}
                        </span>
                        <span className="text-slate-400">
                          {q.source_pdf} (p.{q.page_number})
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Guardrail Badge */}
                        {q.guardrail_status === 'PASSED' ? (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold rounded">
                            <Check className="h-3 w-3" /> Guardrails Passed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-red-50 text-red-700 font-semibold rounded">
                            <X className="h-3 w-3" /> Guardrail Issues
                          </span>
                        )}

                        {/* Solver Badge */}
                        {q.solver_status === 'MATCHED' && (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold rounded">
                            <CheckCircle2 className="h-3 w-3" /> Solver Matched ({q.solver_option})
                          </span>
                        )}
                        {q.solver_status === 'DISCREPANCY' && (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-50 text-amber-700 font-semibold rounded">
                            <AlertTriangle className="h-3 w-3" /> Solver Discrepancy (Ext: {q.correct_option} vs Sol: {q.solver_option})
                          </span>
                        )}

                        {/* Review Status Badge */}
                        <span className={`text-xs px-2 py-0.5 font-bold uppercase rounded ${
                          isApproved ? 'bg-emerald-100 text-emerald-800' :
                          isRejected ? 'bg-red-100 text-red-800' :
                          isPromoted ? 'bg-indigo-100 text-indigo-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {q.review_status}
                        </span>

                        <span className="flex items-center gap-1 text-xs font-mono text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                          <Cpu className="h-3 w-3" /> {q.total_tokens} tok
                        </span>
                      </div>
                    </div>

                    {/* STEM */}
                    <div className="text-base text-slate-900 leading-relaxed font-serif my-3 whitespace-pre-wrap">
                      <MathSpan text={q.question_text_latex} />
                    </div>

                    {/* DISCREPANCY QUICK-RESOLVER BANNER */}
                    {hasDiscrepancy && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-amber-50/90 border border-amber-200 rounded-lg text-xs my-3 text-amber-900 shadow-2xs">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                          <span>
                            Qwen extracted <b>Option {q.correct_option}</b>, but AIR-1 Blind Solver derived <b>Option {q.solver_option}</b>.
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleSelectAnswer(q.id, q.solver_option)}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded cursor-pointer transition-colors shadow-2xs"
                          >
                            Set to Solver ({q.solver_option}) & Approve
                          </button>
                          <button
                            onClick={() => handleSelectAnswer(q.id, q.correct_option)}
                            className="px-2.5 py-1 bg-white hover:bg-amber-100 text-amber-800 border border-amber-300 font-semibold rounded cursor-pointer transition-colors"
                          >
                            Keep Extracted ({q.correct_option})
                          </button>
                        </div>
                      </div>
                    )}

                    {/* OPTIONS */}
                    {opts.length > 0 && (
                      <div className="space-y-1 my-3">
                        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                          Options (Click any option to set as correct answer):
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {opts.map((opt: any, optIdx: number) => {
                            const optLabel = String.fromCharCode(65 + optIdx);
                            const isSelectedCorrectKey = q.correct_option === optLabel;
                            const isSolverKey = q.solver_option === optLabel;

                            return (
                              <div 
                                key={optIdx} 
                                onClick={() => handleSelectAnswer(q.id, optLabel)}
                                title={`Click to set Option ${optLabel} as the correct answer`}
                                className={`p-3 rounded-lg border text-sm flex items-start gap-2.5 cursor-pointer transition-all hover:scale-[1.005] ${
                                  isSelectedCorrectKey 
                                    ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-500/20 text-emerald-950 font-medium'
                                    : 'bg-slate-50/70 border-slate-200 text-slate-800 hover:bg-indigo-50/50 hover:border-indigo-300'
                                }`}
                              >
                                <span className={`font-semibold text-xs rounded px-2 py-0.5 border shrink-0 transition-colors ${
                                  isSelectedCorrectKey ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-200'
                                }`}>
                                  {optLabel}
                                </span>
                                <div className="grow">
                                  <MathSpan text={typeof opt === 'string' ? opt : (opt.text || '')} />
                                </div>
                                {isSelectedCorrectKey && (
                                  <span className="text-[10px] font-bold uppercase bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded shrink-0 flex items-center gap-1 shadow-2xs">
                                    <Check className="h-3 w-3" /> Correct Answer
                                  </span>
                                )}
                                {isSolverKey && !isSelectedCorrectKey && (
                                  <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                                    Solver Derived: {optLabel}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* GUARDRAIL FLAW WARNINGS */}
                    {notes.length > 0 && (
                      <div className="p-3 bg-red-50/80 border border-red-200 rounded-lg text-xs text-red-800 my-2">
                        <div className="font-semibold flex items-center gap-1.5 mb-1">
                          <XCircle className="h-3.5 w-3.5" /> Guardrail Issues Detected:
                        </div>
                        <ul className="list-disc list-inside space-y-0.5">
                          {notes.map((n: string, i: number) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* SOLVER REASONING TOGGLE */}
                    {q.solver_reasoning && (
                      <div className="my-2 border-t border-slate-100 pt-2">
                        <button
                          onClick={() => toggleReasoning(q.id)}
                          className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                        >
                          {expandedReasoning[q.id] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {expandedReasoning[q.id] ? 'Hide Blind Solver Derivation' : 'View AIR-1 Blind Solver Derivation'}
                        </button>
                        {expandedReasoning[q.id] && (
                          <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 font-mono leading-relaxed">
                            <MathSpan text={q.solver_reasoning} />
                          </div>
                        )}
                      </div>
                    )}

                    {/* ACTION BUTTONS */}
                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                      <button
                        onClick={() => handleReject(q.id)}
                        disabled={isRejected || isPromoted}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        <X className="h-3 w-3" /> Reject
                      </button>
                      <button
                        onClick={() => handleApprove(q.id)}
                        disabled={isApproved || isPromoted}
                        className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        <Check className="h-3 w-3" /> Approve for Production
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : activeTab === 'manifest' ? (
        /* MANIFEST TABLE */
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Discovered PDF Ingestion Queue
            </div>
            <div className="text-xs text-slate-500">
              Total 801 Chapter & Test PDFs
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/70 text-slate-600 uppercase border-b border-slate-200 font-semibold">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">PDF Filename</th>
                  <th className="px-4 py-3">Chapter</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Extracted</th>
                  <th className="px-4 py-3 text-right">Passed</th>
                  <th className="px-4 py-3 text-right">Tokens</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {manifest.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 font-mono text-slate-400">{m.id}</td>
                    <td className="px-4 py-2.5 font-semibold text-indigo-700">{m.subject}</td>
                    <td className="px-4 py-2.5 font-medium max-w-xs truncate" title={m.pdf_filename}>{m.pdf_filename}</td>
                    <td className="px-4 py-2.5 text-slate-500">{m.chapter_guess || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        m.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' :
                        m.status === 'IN_PROGRESS' ? 'bg-indigo-100 text-indigo-800 animate-pulse' :
                        m.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{m.extracted_questions}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-emerald-600 font-semibold">{m.passed_guardrails}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-purple-600">{Number(m.total_tokens_used || 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      {m.status === 'PENDING' ? (
                        <button
                          onClick={() => handleExtractNext(m.pdf_path)}
                          disabled={extracting}
                          className="px-2.5 py-1 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded font-semibold text-[11px] cursor-pointer transition-colors shadow-2xs"
                        >
                          Extract Now
                        </button>
                      ) : (
                        <span className="text-slate-400 text-[11px] font-mono">Done</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* DATABASE QUESTION AUDIT & LIVE TEST */
        <div className="space-y-4">
          {/* BANNER & SEARCH BAR */}
          <div className="bg-white p-4 rounded-xl border border-rose-200/80 bg-rose-50/20 shadow-2xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-rose-600" />
                  Live Database Question Audit & Interactive Test Mode
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Browse and test every verified question in the active database. If you spot a broken or poorly formatted question, click <strong className="text-rose-600">Remove from Database</strong> to immediately eliminate it.
                </p>
              </div>
              <div className="text-xs font-semibold px-3 py-1 bg-rose-100 text-rose-800 rounded-full border border-rose-200">
                {dbTotal} Active Questions
              </div>
            </div>

            {/* FILTERS & SEARCH */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-rose-100">
              <div className="flex flex-wrap items-center gap-2">
                {/* VERIFICATION QUEUE TOGGLE */}
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-semibold">
                  <button
                    onClick={() => { setDbVerifiedStatus('UNVERIFIED'); setDbPage(0); fetchDbQuestions(0, dbSubject, dbUnit, dbTopic, dbSearch, 'UNVERIFIED'); }}
                    className={`px-3 py-1.5 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                      dbVerifiedStatus === 'UNVERIFIED'
                        ? 'bg-amber-500 text-white shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>Needs Review</span>
                    <span className="px-1.5 py-0.2 bg-black/15 rounded-full text-[10px]">
                      {dbCounts.unverified || 0}
                    </span>
                  </button>
                  <button
                    onClick={() => { setDbVerifiedStatus('VERIFIED'); setDbPage(0); fetchDbQuestions(0, dbSubject, dbUnit, dbTopic, dbSearch, 'VERIFIED'); }}
                    className={`px-3 py-1.5 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                      dbVerifiedStatus === 'VERIFIED'
                        ? 'bg-emerald-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>Verified</span>
                    <span className="px-1.5 py-0.2 bg-black/15 rounded-full text-[10px]">
                      {dbCounts.verified || 0}
                    </span>
                  </button>
                  <button
                    onClick={() => { setDbVerifiedStatus('ALL'); setDbPage(0); fetchDbQuestions(0, dbSubject, dbUnit, dbTopic, dbSearch, 'ALL'); }}
                    className={`px-3 py-1.5 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                      dbVerifiedStatus === 'ALL'
                        ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>All</span>
                    <span className="px-1.5 py-0.2 bg-black/15 rounded-full text-[10px]">
                      {dbCounts.total || 0}
                    </span>
                  </button>
                </div>

                {/* SUBJECT PILLS */}
                <div className="flex items-center gap-1 text-xs">
                  {['ALL', 'PHYSICS', 'CHEMISTRY', 'MATHEMATICS'].map(subj => (
                    <button
                      key={subj}
                      onClick={() => { 
                        setDbSubject(subj); 
                        setDbUnit('ALL'); 
                        setDbTopic('ALL'); 
                        setDbPage(0); 
                        fetchDbTaxonomy(subj);
                        fetchDbQuestions(0, subj, 'ALL', 'ALL', dbSearch, dbVerifiedStatus); 
                      }}
                      className={`px-3 py-1 rounded-full font-semibold transition-colors cursor-pointer ${
                        dbSubject === subj
                          ? 'bg-rose-600 text-white shadow-2xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {subj}
                    </button>
                  ))}
                </div>
              </div>

              {/* SEARCH INPUT */}
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-full md:w-72">
                <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Search questions by text or UID..."
                  value={dbSearch}
                  onChange={(e) => setDbSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setDbPage(0); fetchDbQuestions(0, dbSubject, dbUnit, dbTopic, dbSearch, dbVerifiedStatus); } }}
                  className="grow bg-transparent outline-none text-slate-800 placeholder-slate-400"
                />
                <button
                  onClick={() => { setDbPage(0); fetchDbQuestions(0, dbSubject, dbUnit, dbTopic, dbSearch, dbVerifiedStatus); }}
                  className="px-2.5 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded text-[11px] border border-rose-200 cursor-pointer"
                >
                  Search
                </button>
              </div>
            </div>

            {/* UNIT & SUBTOPIC DRILL-DOWN FILTERS */}
            <div className="flex flex-wrap items-center gap-3 pt-2.5 border-t border-rose-100/70 text-xs">
              <div className="flex items-center gap-1 text-slate-700 font-bold shrink-0">
                <Filter className="h-3.5 w-3.5 text-rose-600" />
                <span>Unit:</span>
              </div>
              <div className="grow min-w-[240px] max-w-md">
                <select
                  value={dbUnit}
                  onChange={(e) => {
                    const u = e.target.value;
                    setDbUnit(u);
                    setDbTopic('ALL');
                    setDbPage(0);
                    fetchDbQuestions(0, dbSubject, u, 'ALL', dbSearch, dbVerifiedStatus);
                  }}
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-semibold focus:outline-none focus:ring-1 focus:ring-rose-500 cursor-pointer shadow-2xs"
                >
                  <option value="ALL">All Units / Chapters ({dbTaxonomy.length})</option>
                  {dbTaxonomy.map(u => (
                    <option key={u.unit_code} value={u.unit_code}>
                      {u.unit_code} — {u.unit_title} ({u.total_questions} Qs)
                    </option>
                  ))}
                </select>
              </div>

              {/* SUBTOPIC SELECTOR */}
              <div className="flex items-center gap-1 text-slate-700 font-bold shrink-0 ml-1">
                <span>Subtopic:</span>
              </div>
              <div className="grow min-w-[260px] max-w-lg">
                <select
                  value={dbTopic}
                  disabled={dbUnit === 'ALL'}
                  onChange={(e) => {
                    const t = e.target.value;
                    setDbTopic(t);
                    setDbPage(0);
                    fetchDbQuestions(0, dbSubject, dbUnit, t, dbSearch, dbVerifiedStatus);
                  }}
                  className={`w-full bg-white border rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none shadow-2xs cursor-pointer ${
                    dbUnit === 'ALL'
                      ? 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed'
                      : 'border-slate-300 text-slate-800 focus:ring-1 focus:ring-rose-500'
                  }`}
                >
                  <option value="ALL">
                    {dbUnit === 'ALL' ? 'Select a Unit first to choose Subtopic' : 'All 4 Subtopics in this Unit'}
                  </option>
                  {dbUnit !== 'ALL' && dbTaxonomy.find(u => u.unit_code === dbUnit)?.topics?.map((top: any) => (
                    <option key={top.topic_code} value={top.topic_code}>
                      {top.topic_code} — {top.topic_name} ({top.q_count} Qs)
                    </option>
                  ))}
                </select>
              </div>

              {(dbUnit !== 'ALL' || dbTopic !== 'ALL') && (
                <button
                  onClick={() => {
                    setDbUnit('ALL');
                    setDbTopic('ALL');
                    setDbPage(0);
                    fetchDbQuestions(0, dbSubject, 'ALL', 'ALL', dbSearch, dbVerifiedStatus);
                  }}
                  className="px-2.5 py-1 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-md border border-slate-200 text-[11px] font-bold transition-colors cursor-pointer"
                >
                  ✕ Clear Unit & Subtopic
                </button>
              )}
            </div>
          </div>

          {dbDeleteMsg && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-800 text-xs flex items-center justify-between shadow-2xs">
              <span className="font-medium">{dbDeleteMsg}</span>
              <button onClick={() => setDbDeleteMsg(null)} className="text-rose-500 hover:text-rose-700 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* QUESTIONS LIST */}
          {dbLoading ? (
            <div className="p-12 text-center text-slate-500 text-sm bg-white rounded-xl border border-slate-200">
              <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-rose-600" />
              Loading database questions...
            </div>
          ) : dbQuestions.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm bg-white rounded-xl border border-slate-200">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="font-semibold text-slate-700">No questions in this view.</p>
              <p className="text-xs text-slate-400 mt-1">
                {dbVerifiedStatus === 'UNVERIFIED' 
                  ? 'All questions in this selection have been verified! Switch to "All" or "Verified" to view them.'
                  : 'Try adjusting your subject or search criteria.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {dbQuestions.map((q) => {
                const isEditing = editingUid === q.question_uid;
                const isVerified = q.academic_status === 'HUMAN_VERIFIED';
                const userAns = dbUserAnswers[q.question_uid];
                const isRevealed = dbRevealedAnswers[q.question_uid];
                const hasAnswered = !!userAns;
                const opts = Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? JSON.parse(q.options || '[]') : []);

                return (
                  <div key={q.question_uid} className={`bg-white rounded-xl border p-5 shadow-2xs space-y-4 transition-all ${
                    isVerified ? 'border-emerald-200 bg-emerald-50/10' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                    {/* CARD HEADER */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded">
                          #{q.id} ({q.question_uid.slice(0, 16)})
                        </span>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase ${
                          q.subject === 'PHYSICS' ? 'bg-violet-100 text-violet-800' :
                          q.subject === 'CHEMISTRY' ? 'bg-cyan-100 text-cyan-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {q.subject}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                          {q.chapter_name || q.unit_code}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500">
                          {q.primary_topic_code}
                        </span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                          {q.question_type}
                        </span>
                        {isVerified && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded flex items-center gap-1">
                            <Check className="h-3 w-3" /> Verified
                          </span>
                        )}
                      </div>

                      {/* ACTION BUTTONS (VERIFY, EDIT, REMOVE) */}
                      <div className="flex items-center gap-2">
                        {!isVerified && (
                          <button
                            onClick={() => handleVerifyDbQuestion(q.question_uid, q.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-600 hover:text-white border border-emerald-300 rounded-lg transition-all shadow-2xs cursor-pointer"
                            title="Verify question and remove from review queue"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Mark Verified
                          </button>
                        )}
                        <button
                          onClick={() => isEditing ? setEditingUid(null) : handleStartEdit(q)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all shadow-2xs cursor-pointer border ${
                            isEditing 
                              ? 'bg-slate-200 text-slate-800 border-slate-300' 
                              : 'text-indigo-700 bg-indigo-50 hover:bg-indigo-600 hover:text-white border-indigo-300'
                          }`}
                          title="Edit question text, options, or solution"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          {isEditing ? 'Cancel Edit' : 'Edit'}
                        </button>
                        <button
                          onClick={() => handleRemoveDbQuestion(q.question_uid, q.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-600 hover:text-white border border-rose-300 rounded-lg transition-all shadow-2xs cursor-pointer"
                          title="Permanently remove this defective question from active database"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* SOURCE PDF */}
                    {q.source_pdf && (
                      <div className="text-[11px] text-slate-400 truncate">
                        Source: {q.source_pdf}
                      </div>
                    )}

                    {/* INLINE EDIT FORM */}
                    {isEditing ? (
                      <div className="bg-slate-50/80 p-4 rounded-xl border border-indigo-200 space-y-4">
                        <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                          <span className="text-xs font-bold text-indigo-900 uppercase tracking-wide flex items-center gap-1.5">
                            <Edit3 className="h-3.5 w-3.5 text-indigo-600" /> Editing Question #{q.id}
                          </span>
                          <span className="text-[11px] text-slate-500">Changes will be saved directly to PostgreSQL</span>
                        </div>

                        {/* STEM */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Question Stem (LaTeX):</label>
                          <textarea
                            value={editStem}
                            onChange={(e) => setEditStem(e.target.value)}
                            rows={4}
                            className="w-full text-xs font-mono p-3 rounded-lg border border-slate-300 bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                            placeholder="Question stem with LaTeX $...$"
                          />
                          <div className="mt-1 text-[11px] text-slate-400">Live preview:</div>
                          <div className="p-2 bg-white rounded border border-slate-200 text-xs text-slate-800 whitespace-pre-wrap">
                            <MathSpan text={editStem} />
                          </div>
                        </div>

                        {/* OPTIONS (FOR MCQ) */}
                        {opts.length > 0 && (
                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-slate-700">Options (LaTeX):</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {['A', 'B', 'C', 'D'].map((lbl, oIdx) => (
                                <div key={lbl} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-slate-200">
                                  <span className={`font-bold text-xs px-2 py-1 rounded shrink-0 ${
                                    editCorrectOption === lbl ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
                                  }`}>
                                    {lbl}
                                  </span>
                                  <input
                                    type="text"
                                    value={editOptions[oIdx] || ''}
                                    onChange={(e) => {
                                      const next = [...editOptions];
                                      next[oIdx] = e.target.value;
                                      setEditOptions(next);
                                    }}
                                    className="grow text-xs font-mono bg-transparent outline-none text-slate-800"
                                    placeholder={`Option ${lbl} text`}
                                  />
                                </div>
                              ))}
                            </div>

                            {/* CORRECT OPTION SELECTOR */}
                            <div className="flex items-center gap-3 pt-1">
                              <label className="text-xs font-semibold text-slate-700">Correct Option:</label>
                              <div className="flex items-center gap-1.5">
                                {['A', 'B', 'C', 'D'].map(lbl => (
                                  <button
                                    key={lbl}
                                    type="button"
                                    onClick={() => setEditCorrectOption(lbl)}
                                    className={`px-3 py-1 text-xs font-bold rounded-lg border cursor-pointer transition-all ${
                                      editCorrectOption === lbl
                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                                    }`}
                                  >
                                    Option {lbl}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* SOLUTION */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Solution / Derivation (LaTeX):</label>
                          <textarea
                            value={editSolution}
                            onChange={(e) => setEditSolution(e.target.value)}
                            rows={3}
                            className="w-full text-xs font-mono p-3 rounded-lg border border-slate-300 bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                            placeholder="Step-by-step LaTeX derivation..."
                          />
                        </div>

                        {/* ACTION BUTTONS */}
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-indigo-100">
                          <button
                            onClick={() => setEditingUid(null)}
                            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(q.question_uid)}
                            disabled={savingEdit}
                            className="flex items-center gap-1 px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                          >
                            <Save className="h-3.5 w-3.5" />
                            {savingEdit ? 'Saving Changes...' : 'Save & Verify'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* QUESTION STEM */}
                        <div className="text-slate-900 text-sm leading-relaxed whitespace-pre-wrap font-medium">
                          <MathSpan text={q.question_text_latex} />
                        </div>

                        {/* DIAGRAM */}
                        {q.has_diagram && q.diagram_s3_key && (
                          <div className="my-2">
                            <img 
                              src={`http://127.0.0.1:8000/api/v1/images/proxy?key=${encodeURIComponent(q.diagram_s3_key)}`}
                              alt="Question Figure"
                              className="max-h-64 object-contain rounded-lg border border-slate-200 p-2 bg-slate-50/50"
                            />
                          </div>
                        )}

                        {/* OPTIONS (FOR MCQ) */}
                        {opts.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                              <span>Options (Click to test your answer):</span>
                              {!isRevealed && !hasAnswered && (
                                <button
                                  onClick={() => setDbRevealedAnswers(prev => ({ ...prev, [q.question_uid]: true }))}
                                  className="text-indigo-600 hover:text-indigo-800 text-[11px] underline cursor-pointer"
                                >
                                  Reveal Correct Answer
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {opts.map((opt: any, optIdx: number) => {
                                const optLabel = String.fromCharCode(65 + optIdx);
                                const isCorrect = (q.correct_option || '').trim().toUpperCase() === optLabel;
                                const isSelected = userAns === optLabel;

                                let cardStyle = 'bg-slate-50/70 border-slate-200 text-slate-800 hover:bg-slate-100/70';
                                if (isSelected) {
                                  cardStyle = isCorrect
                                    ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-500/20 text-emerald-950 font-bold'
                                    : 'bg-rose-50 border-rose-400 ring-2 ring-rose-500/20 text-rose-950 font-medium';
                                } else if (isRevealed || (hasAnswered && isCorrect)) {
                                  cardStyle = 'bg-emerald-50/60 border-emerald-300 text-emerald-900 font-semibold';
                                }

                                return (
                                  <div
                                    key={optIdx}
                                    onClick={() => setDbUserAnswers(prev => ({ ...prev, [q.question_uid]: optLabel }))}
                                    className={`p-3 rounded-lg border text-sm flex items-start gap-2.5 cursor-pointer transition-all ${cardStyle}`}
                                  >
                                    <span className={`font-semibold text-xs rounded px-2 py-0.5 border shrink-0 ${
                                      isSelected && isCorrect ? 'bg-emerald-600 text-white border-emerald-600' :
                                      isSelected && !isCorrect ? 'bg-rose-600 text-white border-rose-600' :
                                      (isRevealed || (hasAnswered && isCorrect)) ? 'bg-emerald-600 text-white border-emerald-600' :
                                      'bg-white text-slate-700 border-slate-200'
                                    }`}>
                                      {optLabel}
                                    </span>
                                    <div className="grow">
                                      <MathSpan text={typeof opt === 'string' ? opt : (opt.text || '')} />
                                    </div>
                                    {isCorrect && (isRevealed || hasAnswered) && (
                                      <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded shrink-0 flex items-center gap-0.5">
                                        <Check className="h-3 w-3" /> Correct Key
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* NUMERICAL ANSWER DISPLAY */}
                        {q.question_type === 'NUMERICAL' && (
                          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-xs">
                            <span className="text-slate-600 font-medium">Numerical Target Value:</span>
                            <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200 text-sm">
                              {q.correct_option || q.numerical_target || 'N/A'}
                            </span>
                          </div>
                        )}

                        {/* SOLUTION ACCORDION */}
                        {q.solution_text_latex && (
                          <div className="pt-2 border-t border-slate-100">
                            <button
                              onClick={() => setDbExpandedSolution(prev => ({ ...prev, [q.question_uid]: !prev[q.question_uid] }))}
                              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                            >
                              {dbExpandedSolution[q.question_uid] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              {dbExpandedSolution[q.question_uid] ? 'Hide Full Solution & Proof' : 'View Full Solution & Proof'}
                            </button>
                            {dbExpandedSolution[q.question_uid] && (
                              <div className="mt-2.5 p-4 bg-indigo-50/40 border border-indigo-100 rounded-lg text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
                                <MathSpan text={q.solution_text_latex} />
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {/* PAGINATION CONTROLS */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                <div className="text-slate-500 font-medium">
                  Showing {dbPage * dbLimit + 1}–{Math.min(dbTotal, (dbPage + 1) * dbLimit)} of <strong className="text-slate-800">{dbTotal}</strong> questions
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { const p = Math.max(0, dbPage - 1); setDbPage(p); fetchDbQuestions(p, dbSubject, dbUnit, dbTopic, dbSearch, dbVerifiedStatus); }}
                    disabled={dbPage === 0 || dbLoading}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Previous
                  </button>
                  <span className="font-mono font-semibold px-2 text-slate-600">
                    Page {dbPage + 1} of {Math.max(1, Math.ceil(dbTotal / dbLimit))}
                  </span>
                  <button
                    onClick={() => { const p = dbPage + 1; setDbPage(p); fetchDbQuestions(p, dbSubject, dbUnit, dbTopic, dbSearch, dbVerifiedStatus); }}
                    disabled={(dbPage + 1) * dbLimit >= dbTotal || dbLoading}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg disabled:opacity-40 cursor-pointer"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

