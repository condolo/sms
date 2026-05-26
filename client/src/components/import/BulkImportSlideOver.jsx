/* ============================================================
   BulkImportSlideOver — shared CSV import slide-over panel
   Used by: Students (admissions), Teachers (HR), Classes,
            Timetable, Finance

   Props:
     type        string   — import-export type key
     label       string   — human-readable name, e.g. "Students"
     onClose     fn
     onImported  fn(result) — called on successful (or partial) import
     showExport  bool     — show Export button alongside Download Template
   ============================================================ */
import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence }        from 'framer-motion';
import {
  X, Upload, Download, FileText, CheckCircle2,
  AlertTriangle, Loader2, RotateCcw, ChevronRight,
} from 'lucide-react';
import { importExport } from '@/api/client.js';

export default function BulkImportSlideOver({
  type,
  label      = 'Records',
  onClose,
  onImported,
  showExport = false,
}) {
  const [phase,        setPhase]   = useState('idle');   // idle | parsing | uploading | done | error
  const [csvText,      setCsvText] = useState('');
  const [rowCount,     setRowCount] = useState(0);
  const [fileName,     setFileName] = useState('');
  const [result,       setResult]  = useState(null);     // import result from server
  const [serverError,  setServerError] = useState('');
  const [dragging,     setDragging] = useState(false);
  const [downloading,  setDownloading] = useState(false);
  const [exporting,    setExporting] = useState(false);
  const fileInput = useRef(null);

  /* ── File handling ─────────────────────────────────────────── */
  function _countDataRows(text) {
    // Count non-empty, non-comment lines after the header
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) return 0;
    return lines.slice(1).filter(l => !l.startsWith('#')).length;
  }

  function _loadFile(file) {
    if (!file) return;
    if (!file.name.match(/\.(csv|txt)$/i)) {
      setServerError('Please upload a .csv file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setServerError('File too large. Maximum 5 MB.');
      return;
    }
    setPhase('parsing');
    setServerError('');
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      setCsvText(text);
      setRowCount(_countDataRows(text));
      setFileName(file.name);
      setPhase('idle');
    };
    reader.onerror = () => { setServerError('Failed to read file.'); setPhase('idle'); };
    reader.readAsText(file, 'UTF-8');
  }

  function handleFileChange(e) { _loadFile(e.target.files?.[0]); }

  /* ── Drag-and-drop ─────────────────────────────────────────── */
  const onDragOver = useCallback(e => { e.preventDefault(); setDragging(true); }, []);
  const onDragLeave = useCallback(() => setDragging(false), []);
  const onDrop = useCallback(e => {
    e.preventDefault();
    setDragging(false);
    _loadFile(e.dataTransfer.files?.[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Import ────────────────────────────────────────────────── */
  async function handleImport() {
    if (!csvText) return;
    setPhase('uploading');
    setServerError('');
    try {
      const res = await importExport.importCSV(type, csvText);
      setResult(res?.data ?? res);
      setPhase('done');
      if (res?.success || res?.data?.created > 0) {
        onImported?.(res?.data ?? res);
      }
    } catch (err) {
      setServerError(err?.message ?? 'Import failed. Please try again.');
      setPhase('error');
    }
  }

  /* ── Template download ─────────────────────────────────────── */
  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      await importExport.downloadTemplate(type);
    } catch (err) {
      setServerError('Failed to download template.');
    } finally {
      setDownloading(false);
    }
  }

  /* ── Export ────────────────────────────────────────────────── */
  async function handleExport() {
    setExporting(true);
    try {
      await importExport.exportCSV(type);
    } catch (err) {
      setServerError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  /* ── Reset ─────────────────────────────────────────────────── */
  function handleReset() {
    setCsvText('');
    setRowCount(0);
    setFileName('');
    setResult(null);
    setServerError('');
    setPhase('idle');
    if (fileInput.current) fileInput.current.value = '';
  }

  /* ── Rendering ─────────────────────────────────────────────── */
  const isUploading = phase === 'uploading';
  const isDone      = phase === 'done';

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Upload size={15} className="text-slate-400" />
              Import {label}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Upload a CSV file to bulk-import records</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Server / parse error */}
          <AnimatePresence>
            {serverError && (
              <motion.div
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-start gap-2 bg-red-50 text-red-700 text-xs px-3 py-2.5 rounded-lg border border-red-200"
              >
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{serverError}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step 1 — template download */}
          <section className="rounded-xl border border-slate-200 p-4 space-y-2.5">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Step 1 · Get the template</p>
            <p className="text-xs text-slate-500">
              Download the template CSV, fill in your data, then upload it below.
              Leave comment rows (starting with #) in place — they are ignored on import.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleDownloadTemplate}
                disabled={downloading}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
              >
                {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                Download template
              </button>
              {showExport && (
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                >
                  {exporting ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                  Export current {label.toLowerCase()}
                </button>
              )}
            </div>
          </section>

          {/* Step 2 — upload */}
          <section className="rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Step 2 · Upload your CSV</p>

            {!isDone && (
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => fileInput.current?.click()}
                className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed cursor-pointer transition px-4 py-8 text-center
                  ${dragging
                    ? 'border-slate-500 bg-slate-50'
                    : csvText
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
                  }`}
              >
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {phase === 'parsing' ? (
                  <Loader2 size={22} className="text-slate-400 animate-spin" />
                ) : csvText ? (
                  <>
                    <CheckCircle2 size={22} className="text-emerald-600" />
                    <div>
                      <p className="text-sm font-medium text-emerald-700">{fileName}</p>
                      <p className="text-xs text-emerald-600 mt-0.5">
                        {rowCount} data row{rowCount !== 1 ? 's' : ''} detected
                      </p>
                    </div>
                    <p className="text-[11px] text-slate-400">Click to replace</p>
                  </>
                ) : (
                  <>
                    <Upload size={22} className="text-slate-300" />
                    <div>
                      <p className="text-sm font-medium text-slate-600">Drop CSV here or click to browse</p>
                      <p className="text-xs text-slate-400 mt-0.5">Max 500 rows · 5 MB</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Done state — result summary */}
            {isDone && result && (
              <div className="space-y-3">
                <div className={`flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm border ${
                  result.errors?.length > 0 && result.created === 0
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : result.errors?.length > 0
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                }`}>
                  {result.errors?.length > 0 && result.created === 0
                    ? <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    : <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                  }
                  <div>
                    <p className="font-medium">
                      {result.created === 0
                        ? 'Import failed — no records created'
                        : `${result.created} record${result.created !== 1 ? 's' : ''} imported successfully`
                      }
                    </p>
                    {result.skipped > 0 && (
                      <p className="text-xs mt-0.5 opacity-80">{result.skipped} row{result.skipped !== 1 ? 's' : ''} skipped</p>
                    )}
                    {result.updated > 0 && (
                      <p className="text-xs mt-0.5 opacity-80">{result.inserted} new · {result.updated} updated</p>
                    )}
                  </div>
                </div>

                {/* Error table */}
                {result.errors?.length > 0 && (
                  <div className="rounded-lg border border-red-200 overflow-hidden">
                    <div className="bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700 uppercase tracking-wide">
                      {result.errors.length} row error{result.errors.length !== 1 ? 's' : ''}
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-red-100">
                      {result.errors.map((e, i) => (
                        <div key={i} className="px-3 py-2 flex items-start gap-2 text-xs">
                          <span className="text-slate-400 w-10 shrink-0">Row {e.row}</span>
                          <span className="text-red-600">
                            {e.field ? <span className="font-medium">{e.field}: </span> : null}
                            {e.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition"
                >
                  <RotateCcw size={12} /> Import another file
                </button>
              </div>
            )}
          </section>

          {/* Tips */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-1.5">
            <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <ChevronRight size={11} /> Tips
            </p>
            <ul className="text-[11px] text-slate-500 space-y-1 pl-3.5">
              <li>· Maximum 500 rows per file. Split large imports into batches.</li>
              <li>· Rows starting with # are treated as comments and ignored.</li>
              <li>· Required fields are marked in the template — missing values skip the row.</li>
              <li>· Dates must be in YYYY-MM-DD format (e.g. 2026-01-15).</li>
              {type === 'timetable' && (
                <li>· Existing slots with the same class/day/period are updated (not duplicated).</li>
              )}
              {type === 'classes' && (
                <li>· Classes whose name already exists are skipped without error.</li>
              )}
              {type === 'finance' && (
                <li>· Each row creates one invoice — use admissionNumber exactly as shown in Msingi.</li>
              )}
            </ul>
          </section>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">
            {isDone ? 'Close' : 'Cancel'}
          </button>
          {!isDone && (
            <button
              onClick={handleImport}
              disabled={!csvText || isUploading || rowCount === 0}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
            >
              {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {isUploading ? 'Importing…' : `Import ${rowCount > 0 ? rowCount + ' rows' : label}`}
            </button>
          )}
        </div>
      </motion.div>
    </>
  );
}
