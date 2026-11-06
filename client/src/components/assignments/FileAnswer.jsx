/**
 * Reusable file picker for assignment answers.
 * Uploads through the client helper (presigned S3 or local fallback) and
 * reports attachment ids back to the caller.
 */
import { useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, X } from 'lucide-react';
import { assignments as api, uploadAssignmentFile } from '@/api/client.js';

export default function FileAnswer({ assignmentId, value, onChange, compact = false }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [names, setNames] = useState({});

  async function pick(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const id = await uploadAssignmentFile(assignmentId, file);
      setNames(n => ({ ...n, [id]: file.name }));
      onChange([...value, id]);
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={compact ? '' : 'rounded-xl border border-dashed border-slate-300 p-3'}>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt"
        onChange={e => pick(e.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || value.length >= 5}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
          {busy ? 'Uploading…' : 'Attach file'}
        </button>
        <span className="text-[10px] text-slate-400">PDF, image, Word or text · max 10 MB · up to 5</span>
      </div>
      {value.map((id, i) => (
        <div key={id} className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <FileText size={13} className="text-indigo-500" />
          <a
            href={api.attachmentUrl(assignmentId, id)}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-slate-300 hover:text-indigo-600 truncate"
          >
            {names[id] || `Attachment ${i + 1}`}
          </a>
          <button
            type="button"
            onClick={() => onChange(value.filter(x => x !== id))}
            className="text-slate-300 hover:text-red-500"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
