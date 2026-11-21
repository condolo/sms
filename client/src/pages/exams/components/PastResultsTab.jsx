/* ============================================================
   Past Results (v5.278.0) — import earlier academic years' mark sheets.

   One file = one year + term + assessment, one row per student, one
   column per subject (the shape schools keep in Excel; saved as CSV).
   The server checks everything first (preview), nothing is written until
   "Import"; every import can be undone. See server/routes/past-results.js.
   ============================================================ */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  History, Download, Upload, Loader2, CheckCircle2, AlertTriangle, Info, Undo2, FileSpreadsheet,
} from 'lucide-react';
import {
  pastResults as pastApi,
  classes as classesApi,
  assessment as assessmentApi,
  APIError,
} from '@/api/client.js';
import { SelField } from '../../grades/components/GradesPrimitives.jsx';
import { DEFAULT_CUSTOM_TYPES } from '../../grades/constants.js';

const yid = (y) => y?.id ?? y?._id;

function Stat({ label, value, tone = 'slate' }) {
  const tones = {
    slate:   'bg-slate-50 border-slate-200 text-slate-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
    indigo:  'bg-indigo-50 border-indigo-200 text-indigo-700',
    rose:    'bg-rose-50 border-rose-200 text-rose-700',
  };
  return (
    <div className={`rounded-lg border px-3 py-2 ${tones[tone]}`}>
      <div className="text-lg font-semibold leading-tight">{value ?? 0}</div>
      <div className="text-[11px]">{label}</div>
    </div>
  );
}

export default function PastResultsTab({ years = [] }) {
  const qc = useQueryClient();
  const fileRef = useRef(null);

  const [yearId, setYearId]       = useState('');
  const [termNumber, setTerm]     = useState('');
  const [typeKey, setTypeKey]     = useState('');
  const [instance, setInstance]   = useState('1');
  const [outOf, setOutOf]         = useState('100');
  const [classId, setClassId]     = useState('');
  const [onExisting, setExisting] = useState('skip');
  const [file, setFile]           = useState(null); // { name, text }
  const [preview, setPreview]     = useState(null);
  const [error, setError]         = useState('');
  const [done, setDone]           = useState(null);

  const year = years.find(y => yid(y) === yearId) || null;
  const termCount = Math.max(1, Math.min(3, year?.terms?.length || 3));

  const { data: cfgRaw } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => assessmentApi.getConfig(),
    staleTime: 10 * 60_000,
  });
  const types = cfgRaw?.data?.customTypes ?? DEFAULT_CUSTOM_TYPES;
  const typeDef = types.find(t => t.key === typeKey);
  const instanceCount = Number(typeDef?.instances) || 1;

  const { data: classesRaw } = useQuery({
    queryKey: ['classes', 'past-results'],
    queryFn:  () => classesApi.list({ limit: 500 }),
    staleTime: 10 * 60_000,
  });
  const classes = (classesRaw?.data ?? []).map(c => ({ value: c.id ?? c._id, label: c.name }));

  const { data: batchesRaw, isLoading: batchesLoading } = useQuery({
    queryKey: ['past-results', 'batches'],
    queryFn:  () => pastApi.batches(),
  });
  const batches = batchesRaw?.data ?? [];

  const settings = useMemo(() => ({
    academicYearId: yearId, termNumber: Number(termNumber), assessmentType: typeKey,
    instance: Number(instance) || 1, outOf: Number(outOf) || 100,
    classId: classId || undefined, onExisting,
  }), [yearId, termNumber, typeKey, instance, outOf, classId, onExisting]);
  const ready = yearId && termNumber && typeKey && file;

  const errMsg = (e) => (e instanceof APIError ? e.message : 'Something went wrong. Please try again.');

  const previewM = useMutation({
    mutationFn: () => pastApi.preview({ ...settings, csv: file.text, fileName: file.name }),
    onMutate:   () => { setError(''); setDone(null); },
    onSuccess:  (r) => setPreview(r.data),
    onError:    (e) => { setPreview(null); setError(errMsg(e)); },
  });

  const commitM = useMutation({
    mutationFn: () => pastApi.commit({ ...settings, csv: file.text, fileName: file.name }),
    onSuccess:  (r) => {
      setDone(r.data);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['past-results'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'marks'] });
      qc.invalidateQueries({ queryKey: ['reportCards'] });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const undoM = useMutation({
    mutationFn: (id) => pastApi.undo(id),
    onSuccess:  (r) => {
      const d = r?.data || {};
      const kept = (d.lockedKept || 0) + (d.changedKept || 0);
      if (kept) window.alert(`Undone: ${d.removed || 0} removed, ${d.restored || 0} put back. ${kept} mark(s) were kept because they were changed after the import or are on a published report card.`);
      qc.invalidateQueries({ queryKey: ['past-results'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'marks'] });
      qc.invalidateQueries({ queryKey: ['reportCards'] });
    },
    onError: (e) => window.alert(errMsg(e)),
  });

  // Any setting change makes an old preview stale.
  const change = (fn) => (v) => { fn(v); setPreview(null); setDone(null); };

  async function pickFile(e) {
    const f = e.target.files?.[0];
    setPreview(null); setDone(null); setError('');
    if (!f) { setFile(null); return; }
    if (!/\.csv$/i.test(f.name)) {
      setFile(null);
      setError('Please choose a .csv file. In Excel: File → Save As → "CSV UTF-8 (Comma delimited)".');
      return;
    }
    setFile({ name: f.name, text: await f.text() });
  }

  async function downloadTemplate() {
    try {
      const cls = classes.find(c => c.value === classId);
      await pastApi.downloadTemplate({ classId, academicYearId: yearId || undefined, fileName: `past_results_${(cls?.label || 'class').replace(/[^a-z0-9]+/gi, '_')}.csv` });
    } catch (e) { setError(errMsg(e)); }
  }

  function doImport() {
    const p = preview;
    const n = (p?.marks?.toCreate ?? 0) + (p?.marks?.toOverwrite ?? 0);
    const skip = p?.errorCount ? `\n\n${p.errorCount} row(s) with problems will be skipped.` : '';
    const repl = p?.marks?.toOverwrite ? `\n${p.marks.toOverwrite} existing mark(s) will be replaced.` : '';
    if (!window.confirm(`Import ${n} mark(s) into ${p.settings.yearName}, Term ${p.settings.termNumber}, ${p.settings.assessmentLabel}?${repl}${skip}\n\nYou can undo this import afterwards.`)) return;
    commitM.mutate();
  }

  const toWrite = (preview?.marks?.toCreate ?? 0) + (preview?.marks?.toOverwrite ?? 0);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0"><History size={18} className="text-indigo-600" /></div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Import past results</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Bring in marks from earlier academic years, one mark sheet at a time: one year, term and assessment per file,
              one row per student and one column per subject. Each student&apos;s class for that year is saved too, so past
              report cards come out right after promotion.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <SelField label="Academic year" value={yearId} onChange={change(v => { setYearId(v); setTerm(''); })}
            options={years.map(y => ({ value: yid(y), label: y.name }))} placeholder="Choose year…" />
          <SelField label="Term" value={termNumber} onChange={change(setTerm)} disabled={!yearId}
            options={Array.from({ length: termCount }, (_, i) => ({ value: String(i + 1), label: year?.terms?.[i]?.name || `Term ${i + 1}` }))} placeholder="Choose term…" />
          <SelField label="Assessment" value={typeKey} onChange={change(v => { setTypeKey(v); setInstance('1'); })}
            options={types.map(t => ({ value: t.key, label: t.label || t.key }))} placeholder="Choose…" />
          {instanceCount > 1 && (
            <SelField label="Which one" value={instance} onChange={change(setInstance)} placeholder=""
              options={Array.from({ length: instanceCount }, (_, i) => ({ value: String(i + 1), label: `${typeDef?.label || typeKey} ${i + 1}` }))} />
          )}
          <div className="flex flex-col gap-1.5 w-28">
            <label className="text-xs font-medium text-slate-600">Marked out of</label>
            <input type="number" min="1" value={outOf} onChange={e => change(setOutOf)(e.target.value)}
              className="text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10" />
          </div>
          <SelField label="Class" value={classId} onChange={change(setClassId)} options={classes} placeholder="From the file's class column" />
          <SelField label="If a mark is already there" value={onExisting} onChange={change(setExisting)} placeholder=""
            options={[{ value: 'skip', label: 'Keep the existing mark' }, { value: 'overwrite', label: 'Replace it' }]} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={downloadTemplate} disabled={!classId}
            title={classId ? '' : 'Pick a class to get its subjects as columns'}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Download size={14} /> Download template
          </button>
          <label className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer">
            <FileSpreadsheet size={14} /> {file ? file.name : 'Choose CSV file'}
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={pickFile} />
          </label>
          <button onClick={() => previewM.mutate()} disabled={!ready || previewM.isPending}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
            {previewM.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Check file
          </button>
        </div>
        <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
          <Info size={12} className="mt-0.5 shrink-0" />
          Columns: <span className="font-mono">admissionNumber</span>, then one column per subject (its name or code). Optional: name, class, stream.
          A cell is a score, or ABS / MIS / EXM / INC, or empty. Students who have left must be on the system first (Students → Import, status &ldquo;graduated&rdquo;).
          Import before a year is archived.
        </p>

        {error && (
          <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {done && (
          <div className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>
              Imported {done.result.created} new mark(s){done.result.replaced ? `, replaced ${done.result.replaced}` : ''} for {done.result.studentsMatched} student(s) —
              {' '}{done.settings.yearName}, Term {done.settings.termNumber}, {done.settings.assessmentLabel}.
              {done.result.classHistoryRecorded ? ` Class for the year saved for ${done.result.classHistoryRecorded} student(s).` : ''}
              {done.result.rowsWithProblems ? ` ${done.result.rowsWithProblems} row(s) with problems were skipped.` : ''}
              {' '}To issue report cards for it, open Report Cards and pick that year.
            </span>
          </div>
        )}

        {preview && (
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="text-xs text-slate-600">
              <span className="font-semibold text-slate-800">{preview.settings.yearName} · Term {preview.settings.termNumber} · {preview.settings.assessmentLabel}{preview.settings.instance > 1 ? ` ${preview.settings.instance}` : ''}</span>
              {' '}— {preview.rowsTotal} row(s), {preview.studentsMatched} student(s) matched, out of {preview.settings.outOf}.
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <Stat label="New marks" value={preview.marks.toCreate} tone="emerald" />
              <Stat label="Will replace" value={preview.marks.toOverwrite} tone="indigo" />
              <Stat label="Already there (kept)" value={preview.marks.existingSkipped} />
              <Stat label="Locked (kept)" value={preview.marks.lockedSkipped} />
              <Stat label="Class for the year" value={preview.classHistory.toRecord} />
              <Stat label="Rows with problems" value={preview.errorCount} tone={preview.errorCount ? 'rose' : 'slate'} />
            </div>
            <div className="text-xs text-slate-600">
              <span className="font-medium">Subjects found:</span>{' '}
              {preview.columns.subjects.map(c => (c.column === c.subjectName ? c.subjectName : `${c.column} → ${c.subjectName}`)).join(', ')}
            </div>
            {preview.untaggedMarks?.toFile > 0 && (
              <p className="text-[11px] text-slate-500">
                {preview.untaggedMarks.toFile} older mark(s) on the system were saved without a year; importing files them under the year they were entered, so they stay out of this one.
              </p>
            )}

            {preview.errorCount > 0 && (
              <div className="rounded-lg border border-rose-200 overflow-hidden">
                <div className="bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">Rows with problems — these are skipped</div>
                <div className="max-h-48 overflow-y-auto divide-y divide-rose-100">
                  {preview.errors.map((e, i) => (
                    <div key={i} className="px-3 py-1.5 text-xs text-slate-700"><span className="text-slate-400 mr-2">Row {e.row}</span>{e.message}</div>
                  ))}
                  {preview.errorCount > preview.errors.length && <div className="px-3 py-1.5 text-xs text-slate-400">…and {preview.errorCount - preview.errors.length} more</div>}
                </div>
              </div>
            )}
            {preview.warningCount > 0 && (
              <details className="rounded-lg border border-amber-200">
                <summary className="bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 cursor-pointer">{preview.warningCount} note(s)</summary>
                <div className="max-h-48 overflow-y-auto divide-y divide-amber-100">
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="px-3 py-1.5 text-xs text-slate-700">{w.row ? <span className="text-slate-400 mr-2">Row {w.row}</span> : null}{w.message}</div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex items-center gap-2">
              <button onClick={doImport} disabled={!toWrite || commitM.isPending}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                {commitM.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {toWrite ? `Import ${toWrite} mark(s)` : 'Nothing to import'}
              </button>
              {preview.errorCount > 0 && toWrite > 0 && <span className="text-[11px] text-slate-500">or fix the file and check it again</span>}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm">
        <div className="px-5 py-3 border-b border-slate-100 text-sm font-semibold text-slate-800">Past imports</div>
        {batchesLoading ? (
          <div className="p-5"><Loader2 size={16} className="animate-spin text-slate-400" /></div>
        ) : batches.length === 0 ? (
          <p className="p-5 text-xs text-slate-400">No past results imported yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {batches.map(b => (
              <div key={b.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <div className="text-sm text-slate-800">
                    {b.yearName} · Term {b.termNumber} · {b.assessmentLabel}{b.instance > 1 ? ` ${b.instance}` : ''}
                    {b.status === 'undone' && <span className="ml-2 text-[10px] font-semibold uppercase text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Undone</span>}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {b.fileName ? `${b.fileName} · ` : ''}{b.counts?.created ?? 0} new{b.counts?.replaced ? `, ${b.counts.replaced} replaced` : ''} · {b.counts?.studentsMatched ?? 0} students · {new Date(b.createdAt).toLocaleString()}
                  </div>
                </div>
                {b.status !== 'undone' && (
                  <button
                    onClick={() => { if (window.confirm('Undo this import? Marks it added are removed and marks it replaced go back to what they were. Marks locked since by a published report card stay.')) undoM.mutate(b.id); }}
                    disabled={undoM.isPending}
                    className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-rose-700 px-2 py-1 rounded-md hover:bg-rose-50 disabled:opacity-50">
                    <Undo2 size={13} /> Undo
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
