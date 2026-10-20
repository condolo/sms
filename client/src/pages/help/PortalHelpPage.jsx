import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ChevronDown, LifeBuoy, ArrowLeft, LogOut, MessageSquare } from 'lucide-react';
import useAuthStore from '@/store/auth.js';

const FAQS = [
  {
    q: 'How do I sign in?',
    a: 'Use the login details your school gave you. Parents sign in with their email address; students sign in with their admission number. If your school has enabled Google or Microsoft sign-in, use the same email address there.',
  },
  {
    q: 'I forgot my password. What do I do?',
    a: 'Contact your school administrator or the front office. They can reset it from the school’s Users screen and share a new password with you securely.',
  },
  {
    q: 'Where can I see fees and receipts?',
    a: 'Parents: open Fee Statements in your dashboard to see the balance, invoices and receipts. Students: the fee balance is on your dashboard. If a payment is missing, contact the school bursar — never pay through anyone outside the school’s official channels.',
  },
  {
    q: 'Where are report cards?',
    a: 'Report cards appear in Grades & Reports once the school publishes them. Open a term and tap PDF to download the official copy. If a term is missing, it has not been published yet.',
  },
  {
    q: 'Why is attendance incomplete?',
    a: 'Attendance reflects the register your teachers mark. A day without a mark is not an absence. If you believe a record is wrong, contact the class teacher or the school office.',
  },
  {
    q: 'How do I message the school?',
    a: 'Use Messages in your dashboard to contact the teachers and staff your school has made available. For anything private or urgent, call the school office directly.',
  },
  {
    q: 'How do I update my details?',
    a: 'Contact the school office to change your phone number, email, address or your child’s details. Some fields are intentionally locked because they affect official records.',
  },
  {
    q: 'Something is broken or looks wrong. Who do I tell?',
    a: 'Raise a support ticket from the button below. It reaches the Msingi support team together with your school; replies appear in the ticket and are emailed to you.',
  },
];

export default function PortalHelpPage() {
  const navigate = useNavigate();
  const session  = useAuthStore(s => s.session);
  const logout   = useAuthStore(s => s.logout);
  const [open, setOpen] = useState(0);

  const role = session?.user?.role;
  const backTo = role === 'parent' || role === 'guardian'
    ? '/parent-dashboard'
    : role === 'student' ? '/student-dashboard' : '/dashboard';

  return (
    <>
      <Helmet><title>Help & FAQs — {session?.school?.name || 'Msingi'}</title></Helmet>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
            <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
              <ArrowLeft size={15} /> Back
            </Link>
            <div className="ml-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                <LifeBuoy size={16} className="text-indigo-600" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">Help & FAQs</p>
                <p className="text-[11px] text-slate-400">{session?.school?.name}</p>
              </div>
            </div>
            <button
              onClick={() => { logout(); navigate('/login', { replace: true }); }}
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-600"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-3xl space-y-4 px-5 py-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Frequently asked questions</h1>
            <p className="mt-1 text-sm text-slate-500">Quick answers for parents and students.</p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {FAQS.map((item, i) => {
              const expanded = open === i;
              return (
                <div key={item.q} className="border-b border-slate-100 last:border-0">
                  <button
                    onClick={() => setOpen(expanded ? -1 : i)}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50"
                    aria-expanded={expanded}
                  >
                    <span className="flex-1 text-sm font-medium text-slate-800">{item.q}</span>
                    <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded && (
                    <p className="px-5 pb-4 text-sm leading-relaxed text-slate-600">{item.a}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5 sm:flex-row sm:items-center">
            <MessageSquare size={18} className="shrink-0 text-indigo-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">Still need help?</p>
              <p className="text-xs text-slate-600">Raise a support ticket and we will reply here and by email.</p>
            </div>
            <Link to="/support" className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-indigo-700">
              Contact support
            </Link>
          </div>
        </main>
      </div>
    </>
  );
}
