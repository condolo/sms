/* ============================================================
   Help Centre — searchable FAQ + module guides
   ============================================================ */
import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, BookOpen, Users, Wallet, Calendar, FileText, Scale, BarChart3, Settings, GraduationCap, MessageSquare, HelpCircle } from 'lucide-react';

const SECTIONS = [
  {
    id: 'getting-started',
    Icon: BookOpen,
    title: 'Getting Started',
    articles: [
      {
        q: 'How do I sign in?',
        a: 'Open your school portal (e.g. demo.msingi.io), enter your email and password, then click Sign In. If this is your first login you will be prompted to change your password.',
      },
      {
        q: 'I forgot my password. What do I do?',
        a: 'Contact your school administrator. They can reset your password from Settings → Users → Reset Password.',
      },
      {
        q: 'What browsers does Msingi support?',
        a: 'Msingi works best on modern browsers: Chrome, Firefox, Edge, and Safari (all current versions). Internet Explorer is not supported.',
      },
      {
        q: 'Can I use Msingi on my phone?',
        a: 'Yes. Msingi is fully responsive and works on smartphones and tablets. For the best experience use a recent version of Chrome or Safari on mobile.',
      },
      {
        q: 'How is my data stored?',
        a: 'All data is stored securely in a cloud database (MongoDB Atlas). Each school\'s data is completely isolated — other schools cannot access your records.',
      },
    ],
  },
  {
    id: 'students',
    Icon: GraduationCap,
    title: 'Students',
    articles: [
      {
        q: 'How do I add a new student?',
        a: 'Go to Students → click "Add Student" (top right). Fill in the required fields (name, class, admission number) and click Save.',
      },
      {
        q: 'How do I import students from a spreadsheet?',
        a: 'Go to Import & Export → select "Students" → download the template CSV → fill it in → upload the file. The system will create all students in bulk.',
      },
      {
        q: 'Can I move a student to a different class?',
        a: 'Yes. Open the student\'s profile → click Edit → change the Class field → Save. The student\'s history remains intact.',
      },
      {
        q: 'How do I mark a student as transferred or graduated?',
        a: 'Open the student\'s profile → click Edit → change Status to "Transferred" or "Graduated" → Save. The student moves out of the active roll.',
      },
    ],
  },
  {
    id: 'attendance',
    Icon: Calendar,
    title: 'Attendance',
    articles: [
      {
        q: 'How do I mark attendance for my class?',
        a: 'Go to Attendance → select the date and class → mark each student as Present, Absent, Late, or Excused → click Save.',
      },
      {
        q: 'Can I mark attendance for the whole class at once?',
        a: 'Yes. Click "Mark All Present" then adjust individual exceptions. Or use "Bulk Mark" to set a status for multiple students simultaneously.',
      },
      {
        q: 'Where can I see a student\'s attendance history?',
        a: 'Open the student\'s profile — the Attendance tab shows their full attendance record with a monthly summary.',
      },
    ],
  },
  {
    id: 'finance',
    Icon: Wallet,
    title: 'Finance',
    articles: [
      {
        q: 'How do I create a fee invoice for a student?',
        a: 'Go to Finance → Invoices → "New Invoice". Select the student, enter the fee type and amount, set the due date, and click Create.',
      },
      {
        q: 'How do I record a payment?',
        a: 'Open the invoice → click "Record Payment" → enter the amount, date, method (M-PESA, bank, cash), and receipt number → Save.',
      },
      {
        q: 'What does "partial" status mean?',
        a: 'Partial means the student has paid some but not all of their invoice balance. The remaining balance is shown on the invoice.',
      },
      {
        q: 'How do I generate a fee statement for a parent?',
        a: 'Open the student\'s Finance tab in their profile. You can print or download a PDF fee statement showing all invoices and payments.',
      },
    ],
  },
  {
    id: 'behaviour',
    Icon: Scale,
    title: 'Behaviour',
    articles: [
      {
        q: 'How do I record a behaviour incident?',
        a: 'Go to Behaviour → "Record Incident" → select the student, choose Merit or Demerit, set the severity and points, add a description → Save.',
      },
      {
        q: 'What is the Behaviour Point System (BPS)?',
        a: 'BPS tracks merit and demerit points per student. Merits add points; demerits subtract them. The running total gives a behaviour score visible on the student profile.',
      },
      {
        q: 'How do students or parents appeal a demerit?',
        a: 'Staff can submit an appeal on behalf of a student from the incident detail page. Admins resolve appeals with notes — the outcome is logged in the audit trail.',
      },
    ],
  },
  {
    id: 'grades',
    Icon: BarChart3,
    title: 'Grades & Assessment',
    articles: [
      {
        q: 'What is the CA/HW/MT/ET assessment system?',
        a: 'It stands for: CA (Continuous Assessment), HW (Homework), MT (Mid-Term test), ET (End-Term exam). Each has a configurable weight that adds up to 100% of the final grade.',
      },
      {
        q: 'How do I enter marks for a student?',
        a: 'Go to Grades → Markbook → select the term, class, and subject → enter each student\'s score for each assessment task → Save.',
      },
      {
        q: 'How are grade letters assigned?',
        a: 'Grades are calculated from the weighted average of all assessment components. The letter grade (A, B, C, D, E) is mapped from the percentage using the school\'s grading scale.',
      },
    ],
  },
  {
    id: 'messages',
    Icon: MessageSquare,
    title: 'Messages',
    articles: [
      {
        q: 'Who can I send messages to?',
        a: 'Admins and teachers can message all roles. Teachers can message students and parents in their classes. Parents can reply to messages from school staff. Students can message their teachers.',
      },
      {
        q: 'Are messages private?',
        a: 'Yes. Messages are only visible to the sender and recipient(s). Admins can see all messages for audit purposes.',
      },
    ],
  },
  {
    id: 'settings',
    Icon: Settings,
    title: 'Settings',
    articles: [
      {
        q: 'How do I add a new staff member?',
        a: 'Go to Settings → Users → "Invite User". Enter their name, email, and role. They will receive a welcome email with a temporary password.',
      },
      {
        q: 'Can I customise the school logo and colours?',
        a: 'Yes. Go to Settings → Branding. You can upload your school logo, set a primary colour, and customise the login page welcome text.',
      },
      {
        q: 'How do I back up my school data?',
        a: 'Go to Settings → Data → "Download Backup". This exports all your school data as a JSON file that you can store safely.',
      },
    ],
  },
  {
    id: 'roles',
    Icon: Users,
    title: 'Roles & Permissions',
    articles: [
      {
        q: 'What roles are available in Msingi?',
        a: 'Admin, Deputy Principal, Teacher, Finance Officer, HR, Admissions Officer, Discipline Committee, Section Head, Exams Officer, Timetabler, Parent, and Student.',
      },
      {
        q: 'Can I create custom permission sets?',
        a: 'Yes. Go to Settings → Roles. You can adjust which modules each role can Read, Create, Update, or Delete.',
      },
      {
        q: 'What can a parent account see?',
        a: 'Parents can view their child\'s attendance, grades, behaviour history, fee balance, timetable, and messages. They cannot see other students\' data.',
      },
    ],
  },
  {
    id: 'data',
    Icon: FileText,
    title: 'Data & Import/Export',
    articles: [
      {
        q: 'What file format does Msingi import?',
        a: 'Msingi imports CSV files. Download the template from Import & Export to see the exact column headers required.',
      },
      {
        q: 'Can I export my data?',
        a: 'Yes. Go to Import & Export → select a data type → click Export CSV. All records for that type are downloaded as a spreadsheet.',
      },
      {
        q: 'What happens if my import has errors?',
        a: 'The import processes all valid rows and reports any failures. Rows with missing required fields or duplicate IDs are skipped with an error message per row.',
      },
    ],
  },
];

function Article({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        className="flex w-full items-center justify-between gap-3 py-3.5 text-left text-sm font-medium text-slate-800 hover:text-violet-600 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span>{q}</span>
        {open ? <ChevronDown size={14} className="shrink-0 text-violet-500" /> : <ChevronRight size={14} className="shrink-0 text-slate-400" />}
      </button>
      {open && (
        <p className="pb-4 pr-6 text-sm text-slate-600 leading-relaxed">{a}</p>
      )}
    </div>
  );
}

export default function HelpPage() {
  const [query, setQuery]         = useState('');
  const [activeId, setActiveId]   = useState(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return SECTIONS;
    const q = query.toLowerCase();
    return SECTIONS.map(sec => ({
      ...sec,
      articles: sec.articles.filter(
        a => a.q.toLowerCase().includes(q) || a.a.toLowerCase().includes(q),
      ),
    })).filter(sec => sec.articles.length > 0);
  }, [query]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-violet-100 mb-3">
          <HelpCircle size={24} className="text-violet-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Help Centre</h1>
        <p className="text-slate-500 mt-1 text-sm">Find answers to common questions about Msingi.</p>
      </div>

      {/* Search */}
      <div className="relative mb-8">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search help articles…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-slate-500 text-sm py-12">No articles found for "{query}"</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Section list */}
          {!query && (
            <div className="md:col-span-1 space-y-1">
              {SECTIONS.map(sec => (
                <button
                  key={sec.id}
                  onClick={() => setActiveId(id => id === sec.id ? null : sec.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors text-left ${
                    activeId === sec.id
                      ? 'bg-violet-50 text-violet-700 font-medium'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <sec.Icon size={15} className="shrink-0" />
                  {sec.title}
                  <span className="ml-auto text-[11px] text-slate-400">{sec.articles.length}</span>
                </button>
              ))}
            </div>
          )}

          {/* Articles */}
          <div className={query ? 'md:col-span-3 space-y-4' : 'md:col-span-2 space-y-4'}>
            {filtered
              .filter(sec => !activeId || sec.id === activeId || !!query)
              .map(sec => (
                <div key={sec.id} className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="flex items-center gap-2 mb-1 text-slate-900 font-semibold text-sm">
                    <sec.Icon size={15} className="text-violet-500" />
                    {sec.title}
                  </div>
                  <div className="divide-y divide-slate-100">
                    {sec.articles.map((a, i) => <Article key={i} {...a} />)}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
