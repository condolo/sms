/* ============================================================
   Msingi — HR & Staff Route
   /api/hr — Leave requests, payroll, staff documents
   Teachers/staff data lives in /api/teachers; this route
   handles the HR-specific overlays (leave, payroll, docs).
   ============================================================ */
const express        = require('express');
const mongoose       = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware }   = require('../middleware/auth');
const { tenantMiddleware } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

function _model(col) {
  const name = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
                  .replace(/^./, c => c.toUpperCase()) + 'Doc';
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  return mongoose.model(name, schema, col);
}

const HR_ROLES   = ['superadmin', 'admin', 'hr'];
const ADMIN_ROLES = ['superadmin', 'admin'];

/* ══════════════════════════════════════════════════════════════
   LEAVE REQUESTS
   ══════════════════════════════════════════════════════════════ */

/* GET /api/hr/leave — list leave requests */
router.get('/leave', async (req, res) => {
  try {
    const { schoolId, userId, role } = req.jwtUser;
    const { status, staffId } = req.query;
    const Leave = _model('leave_requests');

    const filter = { schoolId };
    // Non-HR staff can only see their own requests
    if (!HR_ROLES.includes(role)) filter.staffId = userId;
    if (status)  filter.status  = status;
    if (staffId && HR_ROLES.includes(role)) filter.staffId = staffId;

    const requests = await Leave.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/hr/leave — submit a leave request */
router.post('/leave', async (req, res) => {
  try {
    const { schoolId, userId, name, role } = req.jwtUser;
    const { type, startDate, endDate, reason, handoverNotes } = req.body;
    if (!type || !startDate || !endDate) {
      return res.status(400).json({ error: 'type, startDate and endDate are required' });
    }
    const days = Math.max(1, Math.round(
      (new Date(endDate) - new Date(startDate)) / 86400000
    ) + 1);

    const request = await _model('leave_requests').create({
      id:       `lr_${uuidv4().slice(0, 8)}`,
      schoolId, staffId: userId, staffName: name,
      type, startDate, endDate, days, reason,
      handoverNotes: handoverNotes || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* PATCH /api/hr/leave/:id/resolve — approve or reject */
router.patch('/leave/:id/resolve', async (req, res) => {
  try {
    const { schoolId, userId, name, role } = req.jwtUser;
    if (!HR_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Only HR or Admin can resolve leave requests' });
    }
    const { status, notes } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved or rejected' });
    }
    const request = await _model('leave_requests').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { status, resolvedBy: name, resolvedById: userId, resolvedAt: new Date().toISOString(), notes } },
      { new: true }
    ).lean();
    if (!request) return res.status(404).json({ error: 'Leave request not found' });
    res.json({ request });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   PAYROLL
   ══════════════════════════════════════════════════════════════ */

/* GET /api/hr/payroll — list payroll records */
router.get('/payroll', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!HR_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Access restricted to HR and Admin' });
    }
    const { period, staffId } = req.query;
    const filter = { schoolId };
    if (period)  filter.payPeriod = period;
    if (staffId) filter.staffId   = staffId;

    const records = await _model('payroll').find(filter).sort({ payPeriod: -1, staffName: 1 }).lean();
    res.json({ records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/hr/payroll — create or update a payroll record */
router.post('/payroll', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!HR_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Access restricted to HR and Admin' });
    }
    const { staffId, staffName, payPeriod, basicSalary, allowances, deductions } = req.body;
    if (!staffId || !payPeriod || basicSalary == null) {
      return res.status(400).json({ error: 'staffId, payPeriod and basicSalary are required' });
    }
    const grossSalary = (basicSalary || 0) + (allowances || 0);
    const netSalary   = grossSalary - (deductions || 0);

    const record = await _model('payroll').findOneAndUpdate(
      { schoolId, staffId, payPeriod },
      { $set: { schoolId, staffId, staffName, payPeriod, basicSalary, allowances: allowances || 0, deductions: deductions || 0, grossSalary, netSalary, updatedAt: new Date().toISOString() } },
      { upsert: true, new: true }
    ).lean();
    res.json({ record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   STAFF DOCUMENTS
   ══════════════════════════════════════════════════════════════ */

const DOC_TYPES = ['contract','appraisal','certificate','id_copy','other'];

/* GET /api/hr/documents */
router.get('/documents', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    const { staffId } = req.query;
    const Docs = _model('staff_documents');
    const filter = { schoolId };
    if (staffId) filter.staffId = staffId;
    if (!HR_ROLES.includes(role) && !staffId) filter.staffId = req.jwtUser.userId;
    const docs = await Docs.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ documents: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/hr/documents */
router.post('/documents', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!HR_ROLES.includes(role)) return res.status(403).json({ error: 'HR/Admin only' });
    const { staffId, staffName, name, type, issuedDate, expiryDate, notes, status } = req.body;
    if (!staffId || !name || !type) return res.status(400).json({ error: 'staffId, name and type are required' });
    if (!DOC_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${DOC_TYPES.join(', ')}` });
    const doc = await _model('staff_documents').create({
      id: `doc_${uuidv4().slice(0,8)}`,
      schoolId, staffId, staffName: staffName || '',
      name, type, issuedDate: issuedDate || null, expiryDate: expiryDate || null,
      notes: notes || '', status: status || 'active',
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ document: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* PUT /api/hr/documents/:id */
router.put('/documents/:id', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!HR_ROLES.includes(role)) return res.status(403).json({ error: 'HR/Admin only' });
    const doc = await _model('staff_documents').findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...req.body, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/hr/documents/:id */
router.delete('/documents/:id', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!HR_ROLES.includes(role)) return res.status(403).json({ error: 'HR/Admin only' });
    const doc = await _model('staff_documents').findOneAndDelete({ id: req.params.id, schoolId }).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/hr/summary — headcount stats for the HR dashboard */
router.get('/summary', async (req, res) => {
  try {
    const { schoolId, role } = req.jwtUser;
    if (!HR_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Access restricted' });
    }
    const [teachers, leaves, payroll] = await Promise.all([
      _model('teachers').find({ schoolId }).lean(),
      _model('leave_requests').find({ schoolId }).lean(),
      _model('payroll').find({ schoolId }).lean(),
    ]);

    const now = new Date().toISOString().slice(0, 7); // YYYY-MM
    const thisMonthPayroll = payroll.filter(p => p.payPeriod === now);

    res.json({
      totalStaff:    teachers.length,
      activeStaff:   teachers.filter(t => t.status === 'active').length,
      onLeave:       teachers.filter(t => t.status === 'on_leave').length,
      pendingLeaves: leaves.filter(l => l.status === 'pending').length,
      totalNetPayroll: thisMonthPayroll.reduce((s, p) => s + (p.netSalary || 0), 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
