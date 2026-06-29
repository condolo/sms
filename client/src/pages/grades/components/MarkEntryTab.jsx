/* ============================================================
   MarkEntryTab — spreadsheet/grid continuous assessment mark entry
   v4.37.0: Excel-like grid (rows=students, cols=type×instance)
   Supports Tab/Enter navigation + clipboard paste (TSV).
   ============================================================ */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { Loader2, Save, PenLine, BookOpen, ClipboardPaste, Lock, Send } from 'lucide-react';
import { assessment as api, classes as classesApi, markSubmissions as submissionsApi } from '@/api/client.js';
import {
  TERM_NUMBERS, DEFAULT_CUSTOM_TYPES, _pct, _scoreColor,
} from '../constants.js';
import { Skeleton, Toast, SelField, iCls, TypePill } from './GradesPrimitives.jsx';

/* ─── Column descriptor ────────────────────────────────────────────── */
function buildCols(customTypes) {
  return customTypes.flatMap(t =>
    Array.from({ length: t.instances ?? 1 }, (_, i) => ({
      typeKey:  t.key,
      label:    t.label || t.key,
      instance: i + 1,
      colId:    t.instances > 1 ? `${t.key}_${i + 1}` : t.key,
      colLabel: t.instances > 1 ? `${t.key} ${i + 1}` : t.key,
      color:    t.color,
      weight:   t.weight,
    }))
  );
}

/* ─── Cell component ─────────────────────────────────────────────── */
function GridCell({ value, rowIdx, colIdx, isLocked, onChange, onNavigate, cellRef }) {
  return (
    <input
      ref={cellRef}
      type="number"
      min="0"
      max="100"
      step="0.5"
      disabled={isLocked}
      value={value ?? ''}
      onChange={e => {
        const v = e.target.value === '' ? undefined : Number(e.target.value);
        if (v === undefined || (v >= 0 && v <= 100)) onChange(v);
      }}
      onKeyDown={e => {
        if (e.key === 'Tab') {
          e.preventDefault();
          onNavigate(rowIdx, colIdx, e.shiftKey ? -1 : 1, 0);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onNavigate(rowIdx, colIdx, 0, 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onNavigate(rowIdx, colIdx, 1, 0);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onNavigate(rowIdx, colIdx, -1, 0);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          onNavigate(rowIdx, colIdx, 0, 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          onNavigate(rowIdx, colIdx, 0, -1);
        }
      }}
      className={`w-full rounded border px-2 py-1 text-right text-sm tabular-nums focus:outline-none transition
        ${isLocked
          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
          : value == null
            ? 'border-slate-200 bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-900/10'
            : value >= 50
              ? 'border-emerald-200 bg-emerald-50/40 focus:border-emerald-400'
              : 'border-red-200 bg-red-50/40 focus:border-red-400'
        }`}
      placeholder="—"
    />
  );
}

/* ─── Submit/recall button ───────────────────────────────────────── */
function SubmitPanel({ classId, subjectId, termNumber, customTypes, onSuccess }) {
  const qc = useQueryClient();

  // Load existing submissions for all types visible in the grid
  const { data: subsData } = useQuery({
    queryKey: ['mark-submissions', { classId, subjectId, termNumber }],
    queryFn:  () => submissionsApi.list({ classId, subjectId, termNumber: Number(termNumber) }),
    enabled:  !!(classId && subjectId && termNumber),
    staleTime: 30_000,
  });
  const subs = subsData?.data ?? [];

  const [toast, setToast] = useState(null);

  const { mutate: submitAll, isPending: submitting } = useMutation({
    mutationFn: async () => {
      const types = customTypes;
      await Promise.all(types.flatMap(t =>
        Array.from({ length: t.instances ?? 1 }, (_, i) =>
          submissionsApi.submit({
            classId,
            subjectId,
            termNumber: Number(termNumber),
            assessmentType: t.key,
            instance: i + 1,
          })
        )
      ));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mark-submissions'] });
      setToast({ msg: 'Marks submitted for review.', type: 'success' });
      onSuccess?.();
    },
    onError: err => setToast({ msg: err?.message ?? 'Submission failed.', type: 'error' }),
  });

  const allLocked  = subs.length > 0 && subs.every(s => s.status === 'locked');
  const anyPending = subs.some(s => s.status === 'submitted' || s.status === 'approved');
  const statusText = allLocked ? 'Locked' : anyPending ? 'Awaiting review' : 'Draft';
  const statusClr  = allLocked ? 'text-slate-500' : anyPending ? 'text-amber-600' : 'text-slate-400';

  return (
    <div className="flex items-center gap-3">
      <AnimatePresence>
        {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
      </AnimatePresence>
      {subs.length > 0 && (
        <span className={`text-xs font-medium ${statusClr} flex items-center gap-1`}>
          {allLocked && <Lock size={11} />}
          {statusText}
        </span>
      )}
      {!allLocked && !anyPending && (
        <button
          onClick={() => submitAll()}
          disabled={submitting}
          className="flex items-center gap-1.5 border border-slate-200 hover:border-slate-400 text-slate-600 hover:text-slate-900 text-xs font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-50"
        >
          {submitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          {submitting ? 'Submitting…' : 'Submit for review'}
        </button>
      )}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────── */
export default function MarkEntryTab() {
  const qc = useQueryClient();
  const [classId,    setClassId]    = useState('');
  const [subjectId,  setSubjectId]  = useState('');
  const [termNumber, setTermNumber] = useState('');
  const [toast,      setToast]      = useState(null);

  // scores[studentId][colId] = rawScore | undefined
  const [scores, setScores] = useState({});
  const [dirty,  setDirty]  = useState(false);

  const cellRefs = useRef({});  // keyed by `${rowIdx}_${colIdx}`

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classesList = classesData?.data ?? [];

  const { data: configData } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => api.getConfig(),
    staleTime: 5 * 60_000,
  });
  const customTypes = configData?.data?.customTypes ?? DEFAULT_CUSTOM_TYPES;
  const cols = useMemo(() => buildCols(customTypes), [customTypes]);

  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const students = studentsData?.data ?? [];

  const canQuery = !!(classId && subjectId && termNumber);

  // Load ALL existing marks for this class/subject/term (all types at once)
  const { data: existingData } = useQuery({
    queryKey: ['assessment', 'marks', { classId, subjectId, termNumber }],
    queryFn:  () => api.getMarks({ classId, subjectId, termNumber: Number(termNumber) }),
    enabled:  canQuery,
    staleTime: 30_000,
  });

  // Load submission statuses to know which cells are locked
  const { data: subsData } = useQuery({
    queryKey: ['mark-submissions', { classId, subjectId, termNumber }],
    queryFn:  () => submissionsApi.list({ classId, subjectId, termNumber: Number(termNumber) }),
    enabled:  canQuery,
    staleTime: 30_000,
  });
  const subs = subsData?.data ?? [];

  const lockedColIds = useMemo(() => {
    const locked = new Set();
    for (const sub of subs) {
      if (sub.status === 'locked') {
        const colId = (sub.instance > 1) ? `${sub.assessmentType}_${sub.instance}` : sub.assessmentType;
        locked.add(colId);
      }
    }
    return locked;
  }, [subs]);

  // Populate scores from loaded marks
  useEffect(() => {
    if (!existingData?.data) return;
    const map = {};
    for (const m of existingData.data) {
      const colId = (m.instance > 1) ? `${m.assessmentType}_${m.instance}` : m.assessmentType;
      map[m.studentId] ??= {};
      map[m.studentId][colId] = m.rawScore;
    }
    setScores(map);
    setDirty(false);
  }, [existingData]);

  // Reset when selection changes
  useEffect(() => { setScores({}); setDirty(false); }, [classId, subjectId, termNumber]);

  const setCell = useCallback((studentId, colId, value) => {
    setScores(prev => ({
      ...prev,
      [studentId]: { ...(prev[studentId] ?? {}), [colId]: value },
    }));
    setDirty(true);
  }, []);

  // Keyboard navigation between cells
  const navigate = useCallback((rowIdx, colIdx, dc, dr) => {
    const newCol = colIdx + dc;
    const newRow = rowIdx + dr;
    const clampedCol = Math.max(0, Math.min(cols.length - 1, newCol));
    const clampedRow = Math.max(0, Math.min(students.length - 1, newRow));
    const key = `${clampedRow}_${clampedCol}`;
    const el  = cellRefs.current[key];
    if (el) { el.focus(); el.select(); }
  }, [cols.length, students.length]);

  // Clipboard paste handler (TSV format from Excel/Sheets)
  const handlePaste = useCallback((e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    const rows = text.trim().split('\n').map(r => r.split('\t'));
    // Determine starting cell
    const focusedKey = Object.keys(cellRefs.current).find(k => cellRefs.current[k] === document.activeElement);
    if (!focusedKey) return;
    const [startRow, startCol] = focusedKey.split('_').map(Number);
    const newScores = { ...scores };
    rows.forEach((cells, dr) => {
      const rIdx = startRow + dr;
      if (rIdx >= students.length) return;
      const sid = students[rIdx]?.id ?? students[rIdx]?._id;
      if (!sid) return;
      newScores[sid] = { ...(newScores[sid] ?? {}) };
      cells.forEach((cell, dc) => {
        const cIdx  = startCol + dc;
        if (cIdx >= cols.length) return;
        const col   = cols[cIdx];
        if (lockedColIds.has(col.colId)) return;
        const v = parseFloat(cell.replace(',', '.'));
        if (!isNaN(v) && v >= 0 && v <= 100) {
          newScores[sid][col.colId] = v;
        }
      });
    });
    setScores(newScores);
    setDirty(true);
  }, [scores, students, cols, lockedColIds]);

  const { mutate: saveAll, isPending: saving } = useMutation({
    mutationFn: () => {
      const marksToSave = [];
      for (const s of students) {
        const sid = s.id ?? s._id;
        for (const col of cols) {
          if (lockedColIds.has(col.colId)) continue;
          const v = scores[sid]?.[col.colId];
          if (v == null) continue;
          marksToSave.push({
            studentId:      sid,
            subjectId,
            classId,
            termNumber:     Number(termNumber),
            assessmentType: col.typeKey,
            instance:       col.instance,
            rawScore:       v,
          });
        }
      }
      return api.bulkMarks({ marks: marksToSave });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'marks'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      setDirty(false);
      setToast({ msg: 'All marks saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Save failed.', type: 'error' }),
  });

  const ready = canQuery && students.length > 0;

  // Per-column stats
  const colStats = useMemo(() => {
    if (!ready) return {};
    const stats = {};
    for (const col of cols) {
      const vals = students
        .map(s => scores[s.id ?? s._id]?.[col.colId])
        .filter(v => v != null)
        .map(Number);
      if (!vals.length) { stats[col.colId] = null; continue; }
      stats[col.colId] = {
        avg:  vals.reduce((a, b) => a + b, 0) / vals.length,
        pass: vals.filter(v => v >= 50).length,
        n:    vals.length,
      };
    }
    return stats;
  }, [scores, students, cols, ready]);

  return (
    <div className="space-y-4">
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* Selection header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Select Assessment</p>
        <div className="flex flex-wrap gap-3">
          <SelField label="Class" value={classId} onChange={v => { setClassId(v); setSubjectId(''); }}
            options={classesList.map(c => ({ value: c.id ?? c._id, label: c.name }))} placeholder="Select class" />
          <div className="flex flex-col gap-1.5 min-w-[180px]">
            <label className="text-xs font-medium text-slate-600">Subject</label>
            <input type="text" value={subjectId} onChange={e => setSubjectId(e.target.value)}
              placeholder="e.g. Mathematics" className={iCls()} />
          </div>
          <SelField label="Term" value={termNumber} onChange={setTermNumber}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))} placeholder="Select term" />
        </div>
      </div>

      {!ready ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <PenLine size={24} className="text-slate-300" />
          <p className="text-sm font-medium text-slate-500">Select class, subject and term above to open the mark sheet</p>
          <p className="text-xs text-slate-400">All assessment types appear as columns. Tab / Enter to navigate; paste from Excel/Sheets.</p>
        </div>
      ) : studentsLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : students.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <BookOpen size={24} className="text-slate-300" />
          <p className="text-sm text-slate-500">No students in this class.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3">
              <p className="text-sm font-semibold text-slate-800">{subjectId} — Term {termNumber}</p>
              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                <ClipboardPaste size={11} /> Paste from Excel
              </span>
              {lockedColIds.size > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                  <Lock size={11} /> {lockedColIds.size} column{lockedColIds.size > 1 ? 's' : ''} locked
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <SubmitPanel
                classId={classId}
                subjectId={subjectId}
                termNumber={termNumber}
                customTypes={customTypes}
              />
              <button
                onClick={() => saveAll()}
                disabled={saving || !dirty}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? 'Saving…' : dirty ? 'Save marks' : 'Saved'}
              </button>
            </div>
          </div>

          {/* Grid */}
          <div className="overflow-x-auto" onPaste={handlePaste}>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 w-8 sticky left-0 bg-slate-50 z-10">#</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5 sticky left-8 bg-slate-50 z-10 min-w-[160px]">Student</th>
                  {cols.map(col => (
                    <th key={col.colId} className="text-center text-xs font-medium text-slate-500 px-2 py-2.5 min-w-[76px]">
                      <TypePill type={col.colLabel} color={col.color} />
                      {lockedColIds.has(col.colId) && (
                        <Lock size={9} className="inline ml-0.5 text-amber-400" />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((s, rowIdx) => {
                  const sid = s.id ?? s._id;
                  return (
                    <tr key={sid} className="hover:bg-slate-50/60 transition">
                      <td className="px-4 py-1.5 text-xs text-slate-400 sticky left-0 bg-white">{rowIdx + 1}</td>
                      <td className="px-3 py-1.5 font-medium text-slate-800 sticky left-8 bg-white min-w-[160px]">
                        <div className="text-sm leading-tight">{s.firstName} {s.lastName}</div>
                        {s.admissionNumber && (
                          <div className="text-[11px] text-slate-400">{s.admissionNumber}</div>
                        )}
                      </td>
                      {cols.map((col, colIdx) => (
                        <td key={col.colId} className="px-2 py-1.5">
                          <GridCell
                            value={scores[sid]?.[col.colId]}
                            rowIdx={rowIdx}
                            colIdx={colIdx}
                            isLocked={lockedColIds.has(col.colId)}
                            onChange={v => setCell(sid, col.colId, v)}
                            onNavigate={navigate}
                            cellRef={el => { cellRefs.current[`${rowIdx}_${colIdx}`] = el; }}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>

              {/* Column stats footer */}
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/80">
                  <td colSpan={2} className="px-4 py-2 text-xs text-slate-500 font-medium sticky left-0 bg-slate-50/80">Avg / Pass</td>
                  {cols.map(col => {
                    const st = colStats[col.colId];
                    return (
                      <td key={col.colId} className="px-2 py-2 text-center text-xs text-slate-500">
                        {st ? (
                          <>
                            <span className={_scoreColor(st.avg)}>{_pct(st.avg)}</span>
                            <span className="block text-[10px] text-slate-400">
                              {st.n}/{students.length} · {Math.round((st.pass / st.n) * 100)}% pass
                            </span>
                          </>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
