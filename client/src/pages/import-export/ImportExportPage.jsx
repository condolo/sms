/**
 * ImportExportPage — Bulk data import/export for Students & Teachers
 *
 * Features:
 *  • Download demo CSV template (with example rows + instructions)
 *  • Upload CSV file → preview row count → import with row-level error report
 *  • Export all records as CSV (downloads immediately)
 */
import { useState, useRef, useCallback } from 'react';
import { importExport as api } from '@/api/client.js';

/* ── Entity definitions ─────────────────────────────────────── */
const ENTITIES = [
  {
    type:        'students',
    label:       'Students',
    icon:        '🎓',
    description: 'Import new students with class assignment, parent contact, and medical notes.',
    fields:      'firstName, lastName, dateOfBirth, gender, className, parentName, parentEmail, parentPhone, address, enrollmentDate, status',
  },
  {
    type:        'teachers',
    label:       'Teachers',
    icon:        '👩‍🏫',
    description: 'Import teaching staff with contact details, qualifications, and contract type.',
    fields:      'firstName, lastName, email, phone, dateOfBirth, gender, title, qualifications, joinDate, contractType, status',
  },
];

/* ── Small helpers ──────────────────────────────────────────── */
function Badge({ children, variant = 'default' }) {
  const colours = {
    default: 'bg-slate-100 text-slate-700',
    success: 'bg-green-100 text-green-700',
    error:   'bg-red-100   text-red-700',
    warning: 'bg-amber-100 text-amber-700',
    info:    'bg-blue-100  text-blue-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colours[variant]}`}>
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-current" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

/* ── Per-entity import card ─────────────────────────────────── */
function ImportCard({ entity }) {
  const fileInputRef   = useRef(null);
  const [file, setFile]           = useState(null);
  const [csvText, setCsvText]     = useState('');
  const [rowCount, setRowCount]   = useState(0);
  const [status, setStatus]       = useState('idle'); // idle | loading | done | error
  const [result, setResult]       = useState(null);
  const [busy, setBusy]           = useState(false);

  /* File selected */
  const handleFileChange = useCallback((e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setStatus('idle');

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      setCsvText(text);
      // Count non-empty, non-comment rows (excluding header)
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      const dataRows = lines.filter((l, i) => {
        if (i === 0) return false; // header
        const t = l.trim();
        return t && !t.startsWith('#');
      });
      setRowCount(dataRows.length);
      setStatus('ready');
    };
    reader.readAsText(f, 'UTF-8');
  }, []);

  /* Drag-and-drop */
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    // Simulate file input
    const dt = new DataTransfer();
    dt.items.add(f);
    fileInputRef.current.files = dt.files;
    handleFileChange({ target: { files: dt.files } });
  }, [handleFileChange]);

  /* Download template */
  async function handleTemplate() {
    setBusy(true);
    try { await api.downloadTemplate(entity.type); }
    catch (err) { alert(`Failed to download template: ${err.message}`); }
    finally { setBusy(false); }
  }

  /* Export */
  async function handleExport() {
    setBusy(true);
    try { await api.exportCSV(entity.type); }
    catch (err) { alert(`Export failed: ${err.message}`); }
    finally { setBusy(false); }
  }

  /* Run import */
  async function handleImport() {
    if (!csvText) return;
    setStatus('loading');
    try {
      const res = await api.importCSV(entity.type, csvText);
      setResult(res?.data ?? res);
      setStatus('done');
    } catch (err) {
      setResult({ error: err.message });
      setStatus('error');
    }
  }

  /* Reset */
  function handleReset() {
    setFile(null);
    setCsvText('');
    setRowCount(0);
    setResult(null);
    setStatus('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
        <span className="text-2xl leading-none mt-0.5">{entity.icon}</span>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-slate-800 text-base">{entity.label}</h2>
          <p className="text-sm text-slate-500 mt-0.5">{entity.description}</p>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleTemplate}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
          >
            {busy ? <Spinner /> : '⬇'}
            Template
          </button>
          <button
            onClick={handleExport}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50 transition"
          >
            {busy ? <Spinner /> : '📤'}
            Export All
          </button>
        </div>
      </div>

      {/* Upload zone */}
      <div className="px-5 py-4">
        {status === 'idle' && (
          <label
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-8 px-4 cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <span className="text-3xl">📂</span>
            <span className="text-sm font-medium text-slate-600">
              Drag & drop a CSV file here, or <span className="text-brand-600 underline">browse</span>
            </span>
            <span className="text-xs text-slate-400">Accepts .csv — max 500 rows per file</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        )}

        {(status === 'ready' || status === 'loading') && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">📄</span>
                <div>
                  <p className="text-sm font-medium text-slate-700 truncate max-w-[260px]">{file?.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    <Badge variant="info">{rowCount} row{rowCount !== 1 ? 's' : ''} detected</Badge>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="text-xs text-slate-500 hover:text-red-500 transition"
                  disabled={status === 'loading'}
                >
                  ✕ Clear
                </button>
                <button
                  onClick={handleImport}
                  disabled={status === 'loading' || rowCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition"
                >
                  {status === 'loading' ? <><Spinner /> Importing…</> : `Import ${rowCount} row${rowCount !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {status === 'done' && result && (
          <div className="space-y-3">
            {/* Summary bar */}
            <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <span className="text-xl">✅</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-green-800">
                  Import complete — <span className="text-green-700">{result.created} record{result.created !== 1 ? 's' : ''} created</span>
                </p>
                {result.skipped > 0 && (
                  <p className="text-xs text-amber-700 mt-0.5">{result.skipped} row{result.skipped !== 1 ? 's' : ''} skipped due to errors</p>
                )}
              </div>
              <button onClick={handleReset} className="text-xs text-slate-500 hover:text-slate-700">Import more</button>
            </div>

            {/* Error table */}
            {result.errors?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-700 mb-1.5">
                  ⚠ {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} had issues:
                </p>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-red-200 bg-red-50">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-red-200 bg-red-100">
                        <th className="px-3 py-1.5 text-left font-semibold text-red-700 w-16">Row</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-red-700 w-28">Field</th>
                        <th className="px-3 py-1.5 text-left font-semibold text-red-700">Issue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr key={i} className="border-b border-red-100 last:border-0">
                          <td className="px-3 py-1.5 text-red-600 font-mono">{e.row ?? '—'}</td>
                          <td className="px-3 py-1.5 text-red-600 font-mono">{e.field ?? '—'}</td>
                          <td className="px-3 py-1.5 text-red-700">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {status === 'error' && result?.error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <span className="text-xl">❌</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800">Import failed</p>
              <p className="text-xs text-red-600 mt-0.5">{result.error}</p>
            </div>
            <button onClick={handleReset} className="text-xs text-slate-500 hover:text-slate-700">Try again</button>
          </div>
        )}
      </div>

      {/* Field reference footer */}
      <div className="border-t border-slate-100 bg-slate-50 px-5 py-2.5">
        <p className="text-xs text-slate-400">
          <span className="font-medium text-slate-500">CSV columns: </span>{entity.fields}
        </p>
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────── */
export default function ImportExportPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-slate-800">Import & Export</h1>
        <p className="mt-1 text-sm text-slate-500">
          Bulk-load data from another system using CSV files, or export your current records for backup or migration.
        </p>
      </div>

      {/* How it works */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800 space-y-1.5">
        <p className="font-semibold text-blue-900">How to import</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-700">
          <li>Click <strong>Template</strong> to download a demo CSV with example rows and column instructions.</li>
          <li>Open the template in Excel, Google Sheets, or any spreadsheet app.</li>
          <li>Fill in your data (rows starting with # are ignored as comments).</li>
          <li>Save as <strong>.csv</strong>, then drag the file here or click to browse.</li>
          <li>Review the detected row count and click <strong>Import</strong>.</li>
        </ol>
        <p className="text-blue-600 text-xs pt-1">
          💡 Tip: Make sure class names match exactly what's in your Classes list before importing students.
          Maximum 500 rows per file — split larger datasets into batches.
        </p>
      </div>

      {/* Entity cards */}
      {ENTITIES.map((entity) => (
        <ImportCard key={entity.type} entity={entity} />
      ))}

      {/* Export-only section for classes */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-start gap-3 px-5 py-4">
          <span className="text-2xl leading-none mt-0.5">📚</span>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-slate-800 text-base">Classes</h2>
            <p className="text-sm text-slate-500 mt-0.5">Export your class list for reference or use in student import files.</p>
          </div>
          <ExportOnlyButton type="classes" label="Export Classes" />
        </div>
      </div>
    </div>
  );
}

function ExportOnlyButton({ type, label }) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try { await api.exportCSV(type); }
    catch (err) { alert(`Export failed: ${err.message}`); }
    finally { setBusy(false); }
  }

  return (
    <button
      onClick={handleExport}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50 transition shrink-0"
    >
      {busy ? <svg className="animate-spin h-4 w-4 text-current" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> : '📤'}
      {label}
    </button>
  );
}
