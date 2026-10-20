import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, X, BookOpen, MessageSquare } from 'lucide-react';
import useAuthStore from '@/store/auth.js';

/**
 * Floating help launcher — available on every authenticated screen
 * (staff shell, parent dashboard, student dashboard).
 *
 * Staff go to the full Help Centre (214 answers); parents and students get
 * the portal FAQ page. Everyone can raise a support ticket from here.
 */
export default function FloatingHelp() {
  const role = useAuthStore(s => s.session?.user?.role);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const isPortal = role === 'parent' || role === 'guardian' || role === 'student';
  const faqHref  = isPortal ? '/portal-help' : '/help';

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2 print:hidden">
      {open && (
        <div className="w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-800">Need help?</p>
            <button onClick={() => setOpen(false)} aria-label="Close help" className="text-slate-400 hover:text-slate-700">
              <X size={14} />
            </button>
          </div>
          <Link to={faqHref} onClick={() => setOpen(false)} className="flex items-start gap-2.5 px-4 py-3 hover:bg-slate-50">
            <BookOpen size={16} className="mt-0.5 shrink-0 text-indigo-600" />
            <span>
              <span className="block text-sm font-medium text-slate-800">{isPortal ? 'Help & FAQs' : 'Help Centre'}</span>
              <span className="block text-[11px] text-slate-500">{isPortal ? 'Answers for parents and students' : 'Search all module answers'}</span>
            </span>
          </Link>
          <Link to="/support" onClick={() => setOpen(false)} className="flex items-start gap-2.5 border-t border-slate-100 px-4 py-3 hover:bg-slate-50">
            <MessageSquare size={16} className="mt-0.5 shrink-0 text-indigo-600" />
            <span>
              <span className="block text-sm font-medium text-slate-800">Contact support</span>
              <span className="block text-[11px] text-slate-500">Raise a ticket and track replies</span>
            </span>
          </Link>
        </div>
      )}

      <button
        id="floating-help-btn"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close help' : 'Open help'}
        aria-expanded={open}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-700"
      >
        {open ? <X size={20} /> : <LifeBuoy size={21} />}
      </button>
    </div>
  );
}
