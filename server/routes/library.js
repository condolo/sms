/* ============================================================
   Msingi — Library Module
   /api/library

   Collections:
     library_books  — book catalogue
     library_loans  — issue / return records

   Plan:  standard | RBAC: MANAGE_ROLES for write; all auth users
          can read catalogue and their own loans.

   Fine logic: default KSh 10 / overdue day; school can override
   via query param finePerDay on the return endpoint.
   ============================================================ */
const express        = require('express');
const { z }          = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E } = require('../utils/response');

const router = express.Router();
const PLAN   = planGate('library');

router.use(authMiddleware, PLAN);

/* ── Roles allowed to manage the library ───────────────────── */
const MANAGE_ROLES = new Set(['superadmin', 'admin', 'librarian']);

/* ── Validation schemas ──────────────────────────────────────── */
const BookSchema = z.object({
  title:        z.string().min(1).max(300).trim(),
  author:       z.string().max(200).trim().optional().default(''),
  isbn:         z.string().max(30).trim().optional().default(''),
  category:     z.string().max(100).trim().optional().default('General'),
  publisher:    z.string().max(200).trim().optional().default(''),
  publishYear:  z.coerce.number().int().min(1000).max(new Date().getFullYear() + 1).optional().nullable(),
  copies:       z.coerce.number().int().min(1).default(1),
  location:     z.string().max(100).trim().optional().default(''),  // shelf/section reference
  description:  z.string().max(1000).trim().optional().default(''),
  coverUrl:     z.string().url().optional().or(z.literal('')).default(''),
});

const LoanSchema = z.object({
  bookId:        z.string().min(1),
  borrowerId:    z.string().min(1),
  borrowerType:  z.enum(['student', 'staff']).default('student'),
  borrowerName:  z.string().max(200).trim().optional().default(''),
  borrowerClass: z.string().max(100).trim().optional().default(''),
  dueDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD'),
});

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   BOOKS — catalogue
   ══════════════════════════════════════════════════════════════ */

/* GET /api/library/books */
router.get('/books', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const { q, category } = req.query;

    const filter = { schoolId };
    if (category) filter.category = category;
    if (q) {
      const re = new RegExp(q.trim(), 'i');
      filter.$or = [{ title: re }, { author: re }, { isbn: re }];
    }

    const [docs, total] = await Promise.all([
      tenantModel('library_books', tenantContext(req)).find(filter).sort({ title: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('library_books', tenantContext(req)).countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[library/books GET]', err);
    return E.serverError(res);
  }
});

/* GET /api/library/books/:id */
router.get('/books/:id', async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('library_books', tenantContext(req)).findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Book not found');
    return ok(res, doc);
  } catch (err) {
    console.error('[library/books GET/:id]', err);
    return E.serverError(res);
  }
});

/* POST /api/library/books */
router.post('/books', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Library staff or Admin access required');

    const { data, error } = _validate(BookSchema, req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('library_books', tenantContext(req)).create({
      id:          uuidv4(),
      schoolId,
      ...data,
      available:   data.copies,  // all copies available on creation
      createdBy:   userId,
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) {
    console.error('[library/books POST]', err);
    return E.serverError(res);
  }
});

/* PUT /api/library/books/:id */
router.put('/books/:id', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Library staff or Admin access required');

    const existing = await tenantModel('library_books', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Book not found');

    const { data, error } = _validate(BookSchema, req.body);
    if (error) return E.validation(res, error);

    /* Recalculate available when total copies change */
    const onLoan = (existing.copies || 0) - (existing.available || 0);
    const newAvailable = Math.max(0, data.copies - onLoan);

    const doc = await tenantModel('library_books', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...data, available: newAvailable, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    return ok(res, doc);
  } catch (err) {
    console.error('[library/books PUT]', err);
    return E.serverError(res);
  }
});

/* DELETE /api/library/books/:id */
router.delete('/books/:id', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Library staff or Admin access required');

    /* Block deletion if any copies are on loan */
    const activeLoans = await tenantModel('library_loans', tenantContext(req)).countDocuments({
      schoolId, bookId: req.params.id, status: 'active',
    });
    if (activeLoans > 0) {
      return E.badRequest(res, `Cannot delete — ${activeLoans} copy/copies are currently on loan`);
    }

    const doc = await tenantModel('library_books', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return E.notFound(res, 'Book not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) {
    console.error('[library/books DELETE]', err);
    return E.serverError(res);
  }
});

/* ══════════════════════════════════════════════════════════════
   LOANS — issue / return
   ══════════════════════════════════════════════════════════════ */

/* GET /api/library/loans */
router.get('/loans', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);
    const { status, borrowerId, bookId } = req.query;

    const filter = { schoolId };
    /* Non-library staff only see their own loans */
    if (!MANAGE_ROLES.has(role)) {
      filter.borrowerId = userId;
    } else {
      if (borrowerId) filter.borrowerId = borrowerId;
    }
    if (status)   filter.status = status;
    if (bookId)   filter.bookId = bookId;

    const [docs, total] = await Promise.all([
      tenantModel('library_loans', tenantContext(req)).find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      tenantModel('library_loans', tenantContext(req)).countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) {
    console.error('[library/loans GET]', err);
    return E.serverError(res);
  }
});

/* POST /api/library/loans — issue a book */
router.post('/loans', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Library staff or Admin access required');

    const { data, error } = _validate(LoanSchema, req.body);
    if (error) return E.validation(res, error);

    const book = await tenantModel('library_books', tenantContext(req)).findOne({ id: data.bookId, schoolId }).lean();
    if (!book) return E.notFound(res, 'Book not found in catalogue');
    if ((book.available ?? 0) < 1) return E.badRequest(res, 'No copies available for this book');

    /* Check borrower does not already have this book on loan */
    const existing = await tenantModel('library_loans', tenantContext(req)).findOne({
      schoolId, bookId: data.bookId, borrowerId: data.borrowerId, status: 'active',
    }).lean();
    if (existing) return E.conflict(res, 'This borrower already has a copy of this book');

    const now = new Date().toISOString();

    /* Create loan + decrement available atomically (best-effort in MongoDB without transactions) */
    const [loan] = await Promise.all([
      tenantModel('library_loans', tenantContext(req)).create({
        id:            uuidv4(),
        schoolId,
        bookId:        data.bookId,
        bookTitle:     book.title,
        borrowerId:    data.borrowerId,
        borrowerType:  data.borrowerType,
        borrowerName:  data.borrowerName,
        borrowerClass: data.borrowerClass,
        issuedAt:      now,
        dueDate:       data.dueDate,
        status:        'active',
        fineAmount:    0,
        finePaid:      false,
        createdBy:     userId,
        createdAt:     now,
      }),
      tenantModel('library_books', tenantContext(req)).updateOne(
        { id: data.bookId, schoolId, available: { $gt: 0 } },
        { $inc: { available: -1 } }
      ),
    ]);
    return created(res, loan.toObject ? loan.toObject() : loan);
  } catch (err) {
    console.error('[library/loans POST]', err);
    return E.serverError(res);
  }
});

/* PATCH /api/library/loans/:id/return — return a book */
router.patch('/loans/:id/return', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Library staff or Admin access required');

    const loan = await tenantModel('library_loans', tenantContext(req)).findOne({ id: req.params.id, schoolId }).lean();
    if (!loan) return E.notFound(res, 'Loan record not found');
    if (loan.status !== 'active') return E.badRequest(res, 'This book has already been returned');

    const returnedAt  = new Date().toISOString();
    const today       = new Date();
    const due         = new Date(loan.dueDate + 'T00:00:00');
    const daysOverdue = Math.max(0, Math.floor((today - due) / 86400000));
    const finePerDay  = Number(req.body?.finePerDay ?? 10);   // default 10 currency units/day
    const fineAmount  = daysOverdue * finePerDay;

    const [updated] = await Promise.all([
      tenantModel('library_loans', tenantContext(req)).findOneAndUpdate(
        { id: req.params.id, schoolId },
        { $set: {
            status:     'returned',
            returnedAt,
            daysOverdue,
            fineAmount,
            updatedBy:  userId,
            updatedAt:  returnedAt,
          }
        },
        { new: true }
      ).lean(),
      tenantModel('library_books', tenantContext(req)).updateOne(
        { id: loan.bookId, schoolId },
        { $inc: { available: 1 } }
      ),
    ]);
    return ok(res, updated);
  } catch (err) {
    console.error('[library/loans PATCH return]', err);
    return E.serverError(res);
  }
});

/* ── Overdue sync — mark active loans past their due date as overdue */
router.post('/loans/sync-overdue', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Library staff or Admin access required');

    const today = new Date().toISOString().slice(0, 10);
    const result = await tenantModel('library_loans', tenantContext(req)).updateMany(
      { schoolId, status: 'active', dueDate: { $lt: today } },
      { $set: { status: 'overdue' } }
    );
    return ok(res, { markedOverdue: result.modifiedCount });
  } catch (err) {
    console.error('[library/loans/sync-overdue POST]', err);
    return E.serverError(res);
  }
});

/* ── Summary ─────────────────────────────────────────────────── */
router.get('/summary', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!MANAGE_ROLES.has(role)) return E.forbidden(res, 'Library staff or Admin access required');

    const today = new Date().toISOString().slice(0, 10);

    const [bookStats, loanStats] = await Promise.all([
      tenantModel('library_books', tenantContext(req)).aggregate([
        { $match: { schoolId } },
        { $group: {
            _id:       null,
            totalBooks:  { $sum: 1 },
            totalCopies: { $sum: '$copies' },
            available:   { $sum: '$available' },
        }},
      ]),
      tenantModel('library_loans', tenantContext(req)).aggregate([
        { $match: { schoolId } },
        { $group: {
            _id:      null,
            active:   { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            overdue:  { $sum: { $cond: [{ $in: ['$status', ['overdue']] }, 1, 0] } },
            totalFines: { $sum: { $cond: [{ $ne: ['$finePaid', true] }, '$fineAmount', 0] } },
        }},
      ]),
    ]);

    /* Also count active loans past due date (not yet marked overdue via sync) */
    const overdueCount = await tenantModel('library_loans', tenantContext(req)).countDocuments({
      schoolId, status: { $in: ['active', 'overdue'] }, dueDate: { $lt: today },
    });

    const bs = bookStats[0] ?? { totalBooks: 0, totalCopies: 0, available: 0 };
    const ls = loanStats[0] ?? { active: 0, overdue: 0, totalFines: 0 };

    return ok(res, {
      totalBooks:    bs.totalBooks,
      totalCopies:   bs.totalCopies,
      available:     bs.available,
      onLoan:        bs.totalCopies - bs.available,
      activeLoans:   ls.active,
      overdueLoans:  overdueCount,
      unpaidFines:   ls.totalFines,
    });
  } catch (err) {
    console.error('[library/summary GET]', err);
    return E.serverError(res);
  }
});

module.exports = router;
