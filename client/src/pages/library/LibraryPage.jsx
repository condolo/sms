import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KpiCard } from '@/components/ui/KpiCard.jsx';
import {
  BookOpen, Plus, Search, BookMarked, Users, AlertTriangle,
  ChevronRight, X, Check, RefreshCw, Trash2, Edit2, ArrowLeft,
} from 'lucide-react';
import { library as libApi, classes as classesApi, students as studentsApi, teachers as teachersApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { useToast } from '@/hooks/useToast.jsx';

/* KpiCard — shared themed component (see @/components/ui/KpiCard.jsx) */

/* ── Empty state ───────────────────────────────────────────── */
function EmptyState({ icon: Icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <Icon size={40} className="mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/* ── Book form modal ──────────────────────────────────────── */
function BookModal({ book, onClose, onSave }) {
  const [form, setForm] = useState({
    title:       book?.title       ?? '',
    author:      book?.author      ?? '',
    isbn:        book?.isbn        ?? '',
    category:    book?.category    ?? 'General',
    classIds:    book?.classIds    ?? [],
    publisher:   book?.publisher   ?? '',
    publishYear: book?.publishYear ?? '',
    copies:      book?.copies      ?? 1,
    location:    book?.location    ?? '',
    description: book?.description ?? '',
    coverUrl:    book?.coverUrl    ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  function toggleClass(id) { set('classIds', form.classIds.includes(id) ? form.classIds.filter(x => x !== id) : [...form.classIds, id]); }

  const { data: cfgData } = useQuery({
    queryKey: ['library', 'config'],
    queryFn:  () => libApi.config.get(),
  });
  const categoryOptions = cfgData?.data?.categories ?? [];

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'for-library'],
    queryFn:  () => classesApi.list({ limit: 200 }),
  });
  const classList = classesData?.data ?? classesData?.classes ?? [];

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err.message ?? 'Failed to save book');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{book ? 'Edit Book' : 'Add Book'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Author</label>
              <input value={form.author} onChange={e => set('author', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">ISBN</label>
              <input value={form.isbn} onChange={e => set('isbn', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {categoryOptions.map(c => <option key={c.key} value={c.label}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Copies *</label>
              <input type="number" min={1} value={form.copies} onChange={e => set('copies', e.target.value)} required
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Class(es) — for records only, not a borrowing restriction</label>
            <div className="flex flex-wrap gap-1.5">
              {classList.length === 0 && <p className="text-xs text-slate-400">No classes found.</p>}
              {classList.map(c => (
                <button key={c.id} type="button" onClick={() => toggleClass(c.id)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${form.classIds.includes(c.id) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Publisher</label>
              <input value={form.publisher} onChange={e => set('publisher', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Publish Year</label>
              <input type="number" min={1000} max={2030} value={form.publishYear} onChange={e => set('publishYear', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Shelf / Location</label>
            <input value={form.location} onChange={e => set('location', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
            <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Book'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Issue loan modal ─────────────────────────────────────── */
function LoanModal({ onClose, onSave }) {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 14);
  const defaultDue = tomorrow.toISOString().slice(0, 10);

  const [form, setForm] = useState({
    bookId: '', borrowerId: '', borrowerType: 'student',
    borrowerName: '', borrowerClass: '', borrowerAdmissionNo: '', dueDate: defaultDue,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const [bookSearch,     setBookSearch]     = useState('');
  const [selectedBook,   setSelectedBook]   = useState(null);
  const [borrowerSearch, setBorrowerSearch] = useState('');
  const [selectedBorrower, setSelectedBorrower] = useState(null);

  const { data: bookResults } = useQuery({
    queryKey: ['library-books', 'issue-search', bookSearch],
    queryFn:  () => libApi.books.list({ q: bookSearch, limit: 10 }),
    enabled:  bookSearch.length > 1,
  });
  const bookOptions = (bookResults?.data ?? []).filter(b => (b.available ?? 0) > 0);

  const { data: studentResults } = useQuery({
    queryKey: ['students', 'library-issue-search', borrowerSearch],
    queryFn:  () => studentsApi.list({ search: borrowerSearch, limit: 10, status: 'active' }),
    enabled:  form.borrowerType === 'student' && borrowerSearch.length > 1,
  });
  const { data: staffResults } = useQuery({
    queryKey: ['teachers', 'library-issue-search', borrowerSearch],
    queryFn:  () => teachersApi.list({ search: borrowerSearch, limit: 10 }),
    enabled:  form.borrowerType === 'staff' && borrowerSearch.length > 1,
  });
  const borrowerOptions = form.borrowerType === 'student'
    ? (studentResults?.data ?? [])
    : (staffResults?.data ?? staffResults?.teachers ?? []);

  function pickBook(b) {
    setSelectedBook(b);
    setBookSearch('');
    set('bookId', b.id ?? b._id);
  }
  function pickBorrower(p) {
    setSelectedBorrower(p);
    setBorrowerSearch('');
    if (form.borrowerType === 'student') {
      setForm(f => ({
        ...f,
        borrowerId: p.id ?? p._id,
        borrowerName: `${p.firstName} ${p.lastName}`,
        borrowerClass: p.className ?? '',
        borrowerAdmissionNo: p.admissionNumber ?? '',
      }));
    } else {
      // Prefer the linked login id — GET /loans' "my own loans" filter
      // matches borrowerId against the viewer's userId, so a teacher
      // with no linked account falls back to their own staff id.
      setForm(f => ({
        ...f,
        borrowerId: p.userId ?? p.id ?? p._id,
        borrowerName: `${p.firstName} ${p.lastName}`,
        borrowerClass: '',
        borrowerAdmissionNo: '',
      }));
    }
  }
  function changeBorrowerType(type) {
    set('borrowerType', type);
    setSelectedBorrower(null);
    setForm(f => ({ ...f, borrowerId: '', borrowerName: '', borrowerClass: '', borrowerAdmissionNo: '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err.message ?? 'Failed to issue book');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Issue Book</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {/* Book picker */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Book *</label>
            {selectedBook ? (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-emerald-800 truncate">{selectedBook.title}</span>
                <button type="button" onClick={() => { setSelectedBook(null); set('bookId', ''); }} className="text-emerald-500 hover:text-emerald-700"><X size={14} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={bookSearch} onChange={e => setBookSearch(e.target.value)} placeholder="Search title, author, or ISBN…"
                  className="w-full pl-9 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {bookOptions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl z-10 mt-1 max-h-48 overflow-y-auto">
                    {bookOptions.map(b => (
                      <button key={b.id ?? b._id} type="button" onClick={() => pickBook(b)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800 truncate">{b.title}</span>
                        <span className="text-xs text-slate-400 shrink-0">{b.available} available</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Borrower type + picker */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Borrower Type</label>
            <select value={form.borrowerType} onChange={e => changeBorrowerType(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="student">Student</option>
              <option value="staff">Staff</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {form.borrowerType === 'student' ? 'Student' : 'Staff Member'} *
            </label>
            {selectedBorrower ? (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-emerald-800">{form.borrowerName}</span>
                  {form.borrowerType === 'student' && (
                    <span className="text-xs text-emerald-600 ml-2">{form.borrowerClass}{form.borrowerAdmissionNo ? ` · ${form.borrowerAdmissionNo}` : ''}</span>
                  )}
                </div>
                <button type="button" onClick={() => { setSelectedBorrower(null); setForm(f => ({ ...f, borrowerId: '', borrowerName: '', borrowerClass: '', borrowerAdmissionNo: '' })); }}
                  className="text-emerald-500 hover:text-emerald-700"><X size={14} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={borrowerSearch} onChange={e => setBorrowerSearch(e.target.value)}
                  placeholder={form.borrowerType === 'student' ? 'Search student name…' : 'Search staff name…'}
                  className="w-full pl-9 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {borrowerOptions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl z-10 mt-1 max-h-48 overflow-y-auto">
                    {borrowerOptions.map(p => (
                      <button key={p.id ?? p._id} type="button" onClick={() => pickBorrower(p)}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm flex items-center gap-2">
                        <span className="font-medium text-slate-800">{p.firstName} {p.lastName}</span>
                        {form.borrowerType === 'student'
                          ? <span className="text-slate-400 text-xs">{p.className}{p.admissionNumber ? ` · ${p.admissionNumber}` : ''}</span>
                          : <span className="text-slate-400 text-xs">{p.role ?? ''}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              {form.borrowerType === 'student'
                ? 'Class and admission number are captured automatically to disambiguate same-name students in different classes.'
                : 'Staff are matched to their own account so borrowed books appear under their Library view.'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Due Date *</label>
            <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving || !form.bookId || !form.borrowerId}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Issuing…' : 'Issue Book'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
export default function LibraryPage() {
  const qc      = useQueryClient();
  const { toast } = useToast();
  const role = useAuthStore(s => s.session?.user?.role ?? 'student');
  const can  = useAuthStore(s => s.can.bind(s));
  // library:read is granted broadly by default (everyone can browse the
  // catalogue) — check the 'create' action specifically so read-only roles
  // don't see manage controls they'd just get a 403 clicking. The real
  // enforcement boundary is the server's rbac('library', action, subKey)
  // checks, not this UI gate.
  const canEdit = can('library', 'create') || role === 'admin' || role === 'superadmin';

  const [tab,    setTab]    = useState('books');    // books | loans
  const [search, setSearch] = useState('');
  const [bookModal, setBookModal] = useState(null);   // null | 'new' | book-object
  const [loanModal, setLoanModal] = useState(false);
  const [deletingBook, setDeletingBook] = useState(null);

  /* ── Queries ─────────────────────────────────────────────── */
  const { data: summaryRaw } = useQuery({
    queryKey: ['library-summary'],
    queryFn:  () => libApi.summary(),
    staleTime: 60_000,
    enabled:  canEdit, // GET /summary is librarian/admin-only server-side
  });

  const { data: booksRaw, isLoading: booksLoading } = useQuery({
    queryKey: ['library-books', search],
    queryFn:  () => libApi.books.list({ q: search || undefined, limit: 50 }),
    staleTime: 30_000,
  });

  const { data: loansRaw, isLoading: loansLoading } = useQuery({
    queryKey: ['library-loans'],
    queryFn:  () => libApi.loans.list({ limit: 50 }),
    staleTime: 30_000,
    enabled:  tab === 'loans',
  });

  const summary = summaryRaw?.data ?? summaryRaw ?? {};
  const books   = booksRaw?.data   ?? [];
  const loans   = loansRaw?.data   ?? [];

  /* ── Mutations ───────────────────────────────────────────── */
  const createBook = useMutation({
    mutationFn: (data) => libApi.books.create(data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['library-books'] }),
    onError:    err => toast.error(err?.message ?? 'Failed to add book.'),
  });
  const updateBook = useMutation({
    mutationFn: ({ id, data }) => libApi.books.update(id, data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['library-books'] }),
    onError:    err => toast.error(err?.message ?? 'Failed to update book.'),
  });
  const deleteBook = useMutation({
    mutationFn: (id) => libApi.books.remove(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['library-books'] });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      setDeletingBook(null);
      toast.success('Book removed from catalogue.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to delete book.'),
  });
  const issueBook = useMutation({
    mutationFn: (data) => libApi.loans.issue(data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['library-loans'] });
      qc.invalidateQueries({ queryKey: ['library-books'] });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      toast.success('Book issued.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to issue book.'),
  });
  const returnBook = useMutation({
    mutationFn: (id) => libApi.loans.return(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['library-loans'] });
      qc.invalidateQueries({ queryKey: ['library-books'] });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      toast.success('Book returned.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to record return.'),
  });
  const markLost = useMutation({
    mutationFn: (id) => libApi.loans.markLost(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['library-loans'] });
      qc.invalidateQueries({ queryKey: ['library-books'] });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      toast.success('Book marked lost.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to mark book lost.'),
  });
  const syncOverdue = useMutation({
    mutationFn: () => libApi.loans.syncOverdue(),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['library-loans'] });
      toast.success('Overdue statuses synced.');
    },
    onError: err => toast.error(err?.message ?? 'Sync failed.'),
  });

  /* ── Save handler ────────────────────────────────────────── */
  async function handleSaveBook(form) {
    try {
      if (bookModal && bookModal !== 'new') {
        await updateBook.mutateAsync({ id: bookModal.id ?? bookModal._id, data: form });
        toast.success('Book updated.');
      } else {
        await createBook.mutateAsync(form);
        toast.success('Book added to catalogue.');
      }
      qc.invalidateQueries({ queryKey: ['library-summary'] });
    } catch (err) {
      toast.error(err?.message ?? 'Failed to save book.');
    }
  }

  /* ── Status badge ────────────────────────────────────────── */
  const loanBadge = (status) => {
    const s = {
      active:   'bg-blue-100 text-blue-700',
      overdue:  'bg-red-100 text-red-700',
      returned: 'bg-emerald-100 text-emerald-700',
      lost:     'bg-slate-800 text-white',
    };
    return s[status] ?? 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-xl">
            <BookMarked size={22} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Library</h1>
            <p className="text-xs text-slate-500">Book catalogue &amp; loans</p>
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button onClick={() => setTab('loans') || setLoanModal(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700">
              <BookOpen size={15} /> Issue Book
            </button>
            <button onClick={() => setBookModal('new')}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-700">
              <Plus size={15} /> Add Book
            </button>
          </div>
        )}
      </div>

      {/* KPIs — librarian/admin only (GET /summary is gated server-side) */}
      {canEdit && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard icon={<BookOpen size={18} />}      label="Total Books"   value={summary.totalBooks}   colorIndex={0} />
          <KpiCard icon={<BookMarked size={18} />}    label="Total Copies"  value={summary.totalCopies}  colorIndex={1} />
          <KpiCard icon={<Check size={18} />}         label="Available"     value={summary.available}    colorIndex={2} />
          <KpiCard icon={<AlertTriangle size={18} />} label="Overdue Loans" value={summary.overdueLoans} colorIndex={3} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {[{ id: 'books', label: 'Books' }, { id: 'loans', label: canEdit ? 'Loans' : 'My Loans' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 text-sm rounded-lg transition ${tab === t.id ? 'bg-white text-slate-800 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Books tab ── */}
      {tab === 'books' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
            <Search size={15} className="text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by title, author or ISBN…"
              className="flex-1 text-sm outline-none bg-transparent placeholder:text-slate-400" />
            {search && (
              <button onClick={() => setSearch('')} className="p-1 rounded-md hover:bg-slate-100 text-slate-400"><X size={13} /></button>
            )}
          </div>
          {booksLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : books.length === 0 ? (
            <EmptyState icon={BookOpen} message="No books in the catalogue yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Title</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Author</th>
                    <th className="px-4 py-3 text-left hidden md:table-cell">Category</th>
                    <th className="px-4 py-3 text-center">Copies</th>
                    <th className="px-4 py-3 text-center">Available</th>
                    {canEdit && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {books.map(book => (
                    <tr key={book.id ?? book._id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800 line-clamp-1">{book.title}</div>
                        {book.isbn && <div className="text-xs text-slate-400 font-mono">{book.isbn}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{book.author || '—'}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs">{book.category}</span>
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-slate-700">{book.copies}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-semibold ${(book.available ?? 0) > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {book.available ?? 0}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => setBookModal(book)}
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                              <Edit2 size={14} />
                            </button>
                            <button onClick={() => setDeletingBook(book)}
                              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Loans tab ── */}
      {tab === 'loans' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {canEdit ? (
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-sm text-slate-500">{loans.length} loan record{loans.length !== 1 ? 's' : ''}</span>
              <button onClick={() => syncOverdue.mutate()}
                disabled={syncOverdue.isPending}
                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw size={12} className={syncOverdue.isPending ? 'animate-spin' : ''} />
                Sync Overdue
              </button>
            </div>
          ) : (
            <div className="px-4 py-3 border-b border-slate-100">
              <span className="text-sm text-slate-500">Books you currently have on loan from the library</span>
            </div>
          )}
          {loansLoading ? (
            <div className="flex justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>
          ) : loans.length === 0 ? (
            <EmptyState icon={Users} message="No loan records found" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Book</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Borrower</th>
                    <th className="px-4 py-3 text-left hidden md:table-cell">Due Date</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right hidden sm:table-cell">Fine</th>
                    {canEdit && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loans.map(loan => (
                    <tr key={loan.id ?? loan._id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800 line-clamp-1">{loan.bookTitle ?? '—'}</div>
                        <div className="text-xs text-slate-400 font-mono line-clamp-1">{loan.bookId}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                        <div>{loan.borrowerName || loan.borrowerId}</div>
                        {loan.borrowerClass && <div className="text-xs text-slate-400">{loan.borrowerClass}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{loan.dueDate ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${loanBadge(loan.status)}`}>
                          {loan.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        {loan.fineAmount > 0
                          ? <span className={`font-medium ${loan.finePaid ? 'text-emerald-600' : 'text-red-600'}`}>
                              KSh {loan.fineAmount}{loan.finePaid ? ' ✓' : ''}
                            </span>
                          : <span className="text-slate-400">—</span>
                        }
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          {(loan.status === 'active' || loan.status === 'overdue') && (
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => returnBook.mutate(loan.id ?? loan._id)}
                                disabled={returnBook.isPending || markLost.isPending}
                                className="text-xs px-3 py-1 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                                Return
                              </button>
                              <button onClick={() => confirm(`Mark "${loan.bookTitle}" as lost? This permanently removes a copy from the catalogue.`) && markLost.mutate(loan.id ?? loan._id)}
                                disabled={returnBook.isPending || markLost.isPending}
                                className="text-xs px-3 py-1 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                                Mark Lost
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      {bookModal && (
        <BookModal
          book={bookModal === 'new' ? null : bookModal}
          onClose={() => setBookModal(null)}
          onSave={handleSaveBook}
        />
      )}
      {loanModal && (
        <LoanModal
          onClose={() => setLoanModal(false)}
          onSave={(data) => issueBook.mutateAsync(data)}
        />
      )}

      {/* Delete confirm */}
      {deletingBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <h3 className="font-semibold text-slate-800">Delete Book?</h3>
            <p className="text-sm text-slate-600">
              Remove <span className="font-medium">"{deletingBook.title}"</span> from the catalogue? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingBook(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Cancel</button>
              <button onClick={() => deleteBook.mutate(deletingBook.id ?? deletingBook._id)}
                disabled={deleteBook.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {deleteBook.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
