/* Teachers still assigned to a whole class whose subject now needs one teacher
   per stream (v5.282.0). Shown after a stream is added or a subject is made
   compulsory. Nothing is moved automatically. */
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';

export default function NeedsStreamNotice({ items, className = '', onClose }) {
  if (!items?.length) return null;
  return (
    <div className={`bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900 ${className}`} role="status">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1">
          <p className="font-semibold">{items.length === 1 ? '1 teaching assignment needs' : `${items.length} teaching assignments need`} a stream</p>
          <p>These teachers were assigned to the whole class and keep access to every stream until someone chooses their stream in{' '}
            <Link to="/timetable?view=allocation" className="underline font-medium">Timetable → Subject allocation</Link> (Move to stream).</p>
          <ul className="list-disc pl-4">
            {items.slice(0, 12).map(i => <li key={i.assignmentId}>{i.subjectName || 'Subject'}{i.className ? `, ${i.className}` : ''}: {i.teacherName || 'teacher'}</li>)}
            {items.length > 12 && <li>and {items.length - 12} more</li>}
          </ul>
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close" className="text-amber-700 hover:text-amber-900"><X size={14} /></button>}
      </div>
    </div>
  );
}
