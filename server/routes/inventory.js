/* ============================================================
   Msingi — /api/inventory  (Inventory — Module 2, milestone 1)
   Sub-routes:
     /api/inventory/categories — school-editable category catalogue
     /api/inventory/items      — inventory items (non-library assets/consumables)

   Plan: core | RBAC: inventory:{view,manage,transact,requisition,workflow}
   (see server/config/moduleRegistry.js)

   Version 1 is deliberately lightweight per the module spec — flat
   categories (no nested items, unlike Behaviour's category→items model;
   there's no per-category numeric value here to carry), no asset-tag/
   serial-number tracking, no depreciation. Categories/Items follow the
   Behaviour-categories precedent for auto-seeding sensible defaults on
   a school's first read rather than the Departments precedent (which
   ships with none) — a fixed starter set (ICT, Laboratory, Sports, ...)
   is the useful default here the way BPS categories were for Behaviour.
   ============================================================ */
const express = require('express');
const { z }   = require('zod');
const { v4: uuidv4 } = require('uuid');

const { authMiddleware } = require('../middleware/auth');
const { moduleGate }     = require('../middleware/module-gate');
const { rbac, hasPermission } = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E, strParam } = require('../utils/response');
const AuditService = require('../services/audit');
const {
  getWorkflowConfig, saveWorkflowConfig, resolveStep, resolveAssigneeLabel,
} = require('../utils/workflow-config');

const REQ_WORKFLOW_KEY = 'inventory_requisition';

const router  = express.Router();
const PLAN    = planGate('inventory');
const MODGATE = moduleGate('inventory');

function _validate(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) return { error: r.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) };
  return { data: r.data };
}

/* ══════════════════════════════════════════════════════════════
   CATEGORIES
   ══════════════════════════════════════════════════════════════ */
const CategorySchema = z.object({
  name:        z.string().min(1).max(100).trim(),
  description: z.string().max(300).optional(),
  isActive:    z.boolean().default(true),
});

const DEFAULT_CATEGORY_NAMES = ['ICT', 'Laboratory', 'Sports', 'Furniture', 'Office', 'Cleaning', 'Kitchen'];

async function _ensureDefaultCategories(schoolId, ctx, userId) {
  const Categories = tenantModel('inventory_categories', ctx);
  const count = await Categories.countDocuments({ schoolId });
  if (count > 0) return;
  await Categories.insertMany(DEFAULT_CATEGORY_NAMES.map(name => ({
    id: uuidv4(), schoolId, name, isActive: true,
    createdBy: userId || 'system', updatedBy: userId || 'system',
  })));
}

router.get('/categories', authMiddleware, PLAN, MODGATE, rbac('inventory', 'read', 'view'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    await _ensureDefaultCategories(schoolId, tenantContext(req), userId);

    const filter = { schoolId };
    if (req.query.isActive) filter.isActive = req.query.isActive === 'true';

    const docs = await tenantModel('inventory_categories', tenantContext(req))
      .find(filter).sort({ name: 1 }).limit(200).select('-__v').lean();
    return ok(res, docs);
  } catch (err) { console.error('[inventory/categories GET]', err); return E.serverError(res); }
});

router.post('/categories', authMiddleware, PLAN, MODGATE, rbac('inventory', 'create', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CategorySchema, req.body);
    if (error) return E.validation(res, error);

    const Categories = tenantModel('inventory_categories', tenantContext(req));
    const existing = await Categories.findOne({ schoolId, name: data.name }).lean();
    if (existing) return E.conflict(res, `A category named '${data.name}' already exists.`);

    const doc = await Categories.create({
      ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId,
    });
    return created(res, doc.toObject ? doc.toObject() : doc);
  } catch (err) { console.error('[inventory/categories POST]', err); return E.serverError(res); }
});

router.put('/categories/:id', authMiddleware, PLAN, MODGATE, rbac('inventory', 'update', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(CategorySchema.partial(), req.body);
    if (error) return E.validation(res, error);

    const doc = await tenantModel('inventory_categories', tenantContext(req)).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...data, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Category not found');
    return ok(res, doc);
  } catch (err) { console.error('[inventory/categories PUT]', err); return E.serverError(res); }
});

router.delete('/categories/:id', authMiddleware, PLAN, MODGATE, rbac('inventory', 'delete', 'manage'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const inUse = await tenantModel('inventory_items', tenantContext(req)).countDocuments({ schoolId, categoryId: req.params.id });
    if (inUse > 0) return E.badRequest(res, `Cannot delete — ${inUse} item(s) still use this category. Reassign or remove them first.`);

    const deleted = await tenantModel('inventory_categories', tenantContext(req)).findOneAndDelete({ id: req.params.id, schoolId });
    if (!deleted) return E.notFound(res, 'Category not found');
    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[inventory/categories DELETE]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   ITEMS
   ══════════════════════════════════════════════════════════════ */
const ITEM_STATUSES = ['active', 'inactive', 'discontinued'];
const ItemSchema = z.object({
  itemCode:     z.string().min(1).max(50).trim(),
  name:         z.string().min(1).max(200).trim(),
  categoryId:   z.string().min(1),
  categoryName: z.string().max(100).optional(), // denormalized, resolved server-side if omitted
  quantity:     z.number().int().min(0).default(0),
  unit:         z.string().max(30).trim().default('pcs'),
  location:     z.string().max(200).optional(), // store/location
  status:       z.enum(ITEM_STATUSES).default('active'),
});

router.get('/items', authMiddleware, PLAN, MODGATE, rbac('inventory', 'read', 'view'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    const _cat = strParam(req.query.categoryId);
    const _st  = strParam(req.query.status);
    if (_cat) filter.categoryId = _cat;
    if (_st)  filter.status     = _st;
    if (req.query.search) {
      const rx = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { itemCode: rx }];
    }

    const Items = tenantModel('inventory_items', tenantContext(req));
    const [docs, total] = await Promise.all([
      Items.find(filter).sort({ name: 1 }).skip(skip).limit(limit).select('-__v').lean(),
      Items.countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[inventory/items GET]', err); return E.serverError(res); }
});

router.get('/items/:id', authMiddleware, PLAN, MODGATE, rbac('inventory', 'read', 'view'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const doc = await tenantModel('inventory_items', tenantContext(req)).findOne({ id: req.params.id, schoolId }).select('-__v').lean();
    if (!doc) return E.notFound(res, 'Item not found');
    return ok(res, doc);
  } catch (err) { console.error('[inventory/items GET/:id]', err); return E.serverError(res); }
});

router.post('/items', authMiddleware, PLAN, MODGATE, rbac('inventory', 'create', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ItemSchema, req.body);
    if (error) return E.validation(res, error);

    const ctx = tenantContext(req);
    const Items = tenantModel('inventory_items', ctx);

    const existing = await Items.findOne({ schoolId, itemCode: data.itemCode }).lean();
    if (existing) return E.conflict(res, `An item with code '${data.itemCode}' already exists.`);

    if (!data.categoryName) {
      const category = await tenantModel('inventory_categories', ctx).findOne({ id: data.categoryId, schoolId }).select('name').lean();
      if (!category) return E.badRequest(res, 'Unknown categoryId.');
      data.categoryName = category.name;
    }

    const doc = await Items.create({
      ...data, id: uuidv4(), schoolId, createdBy: userId, updatedBy: userId,
    });
    const plain = doc.toObject ? doc.toObject() : doc;

    AuditService.log({
      action: 'inventory.item_created', actor: req.jwtUser, schoolId,
      target: { type: 'inventory_item', id: plain.id, label: plain.name },
      details: { itemCode: plain.itemCode, categoryName: plain.categoryName, quantity: plain.quantity }, req,
    });

    return created(res, plain);
  } catch (err) { console.error('[inventory/items POST]', err); return E.serverError(res); }
});

router.put('/items/:id', authMiddleware, PLAN, MODGATE, rbac('inventory', 'update', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(ItemSchema.partial(), req.body);
    if (error) return E.validation(res, error);

    // quantity is server-owned once transactions exist — it only ever
    // moves through the transaction ledger (milestone 2), never a direct
    // field edit, so the historical trail stays trustworthy.
    delete data.quantity;

    const ctx = tenantContext(req);
    if (data.categoryId && !data.categoryName) {
      const category = await tenantModel('inventory_categories', ctx).findOne({ id: data.categoryId, schoolId }).select('name').lean();
      if (!category) return E.badRequest(res, 'Unknown categoryId.');
      data.categoryName = category.name;
    }

    const doc = await tenantModel('inventory_items', ctx).findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { ...data, updatedBy: userId, updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!doc) return E.notFound(res, 'Item not found');
    return ok(res, doc);
  } catch (err) { console.error('[inventory/items PUT]', err); return E.serverError(res); }
});

router.delete('/items/:id', authMiddleware, PLAN, MODGATE, rbac('inventory', 'delete', 'manage'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const ctx = tenantContext(req);

    const hasHistory = await tenantModel('inventory_transactions', ctx).countDocuments({ schoolId, itemId: req.params.id });
    if (hasHistory > 0) {
      return E.badRequest(res, 'This item has recorded stock transactions and cannot be deleted — set its status to discontinued instead.');
    }

    const deleted = await tenantModel('inventory_items', ctx).findOneAndDelete({ id: req.params.id, schoolId });
    if (!deleted) return E.notFound(res, 'Item not found');

    AuditService.log({
      action: 'inventory.item_deleted', actor: req.jwtUser, schoolId,
      target: { type: 'inventory_item', id: req.params.id, label: deleted.name }, req,
    });

    return ok(res, { id: req.params.id, deleted: true });
  } catch (err) { console.error('[inventory/items DELETE]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   STOCK TRANSACTIONS — the movement ledger. Append-only: no PUT,
   no DELETE. A mistake is corrected with an offsetting adjustment,
   never by editing or removing the original entry.
   ══════════════════════════════════════════════════════════════ */
const TXN_TYPES    = ['receive', 'issue', 'return', 'adjustment'];
const SIGN_BY_TYPE  = { receive: 1, issue: -1, return: 1 }; // adjustment's sign comes from `direction` instead

const TransactionSchema = z.object({
  itemId:    z.string().min(1),
  type:      z.enum(TXN_TYPES),
  quantity:  z.number().int().positive(),
  direction: z.enum(['increase', 'decrease']).optional(), // required only for type:'adjustment'
  reason:    z.string().max(500).optional(),
  date:      z.string().optional(), // ISO date; defaults to today
});

router.get('/transactions', authMiddleware, PLAN, MODGATE, rbac('inventory', 'read', 'view'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    const _item = strParam(req.query.itemId);
    const _type = strParam(req.query.type);
    if (_item) filter.itemId = _item;
    if (_type) filter.type   = _type;

    const _df = strParam(req.query.dateFrom);
    const _dt = strParam(req.query.dateTo);
    if (_df || _dt) {
      filter.date = {};
      if (_df) filter.date.$gte = _df;
      if (_dt) filter.date.$lte = _dt;
    }

    const Txns = tenantModel('inventory_transactions', tenantContext(req));
    const [docs, total] = await Promise.all([
      Txns.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Txns.countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[inventory/transactions GET]', err); return E.serverError(res); }
});

router.post('/transactions', authMiddleware, PLAN, MODGATE, rbac('inventory', 'create', 'transact'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { data, error } = _validate(TransactionSchema, req.body);
    if (error) return E.validation(res, error);

    let sign;
    if (data.type === 'adjustment') {
      if (!data.direction) return E.badRequest(res, "direction ('increase' or 'decrease') is required for adjustment transactions");
      if (!data.reason?.trim()) return E.badRequest(res, 'A reason is required for adjustment transactions');
      sign = data.direction === 'increase' ? 1 : -1;
    } else {
      sign = SIGN_BY_TYPE[data.type];
    }
    const delta = sign * data.quantity;

    const ctx   = tenantContext(req);
    const Items = tenantModel('inventory_items', ctx);

    const item = await Items.findOne({ id: data.itemId, schoolId }).select('name unit quantity').lean();
    if (!item) return E.badRequest(res, 'Unknown itemId.');

    // Atomic $inc with a guard condition — avoids a lost-update race
    // between two concurrent transactions on the same item (both reading
    // the same starting quantity, one silently overwriting the other's
    // decrement). The guard (quantity >= -delta) only bites for negative
    // deltas (issue / decrease-adjustment); it's always satisfied for
    // positive ones, so receive/return/increase never get blocked here.
    const updatedItem = await Items.findOneAndUpdate(
      { id: data.itemId, schoolId, quantity: { $gte: -delta } },
      { $inc: { quantity: delta }, $set: { updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();
    if (!updatedItem) {
      return E.badRequest(res, `Insufficient stock — only ${item.quantity} ${item.unit} available.`);
    }

    let doc;
    try {
      doc = await tenantModel('inventory_transactions', ctx).create({
        id: uuidv4(), schoolId,
        itemId: data.itemId, itemName: item.name,
        type: data.type, quantity: data.quantity, delta,
        direction: data.type === 'adjustment' ? data.direction : undefined,
        reason: data.reason ?? '',
        date: data.date || new Date().toISOString().slice(0, 10),
        performedBy: userId, createdAt: new Date().toISOString(),
      });
    } catch (ledgerErr) {
      // The item quantity already moved (atomically, above) but the
      // ledger entry explaining it failed to write — roll the quantity
      // back rather than leave an unexplained change with no audit
      // trail. A full multi-document Mongo transaction (see
      // report-cards.js's snapshot writes for that pattern) would avoid
      // needing this rollback at all, but brings session-lifecycle and
      // standalone-MongoDB-fallback complexity this module's "keep V1
      // lightweight" mandate doesn't justify for what's a rare failure
      // window between two sequential writes — not the concurrency race,
      // which the $inc guard above already owns on its own.
      await Items.updateOne({ id: data.itemId, schoolId }, { $inc: { quantity: -delta } });
      throw ledgerErr;
    }
    const plain = doc.toObject ? doc.toObject() : doc;

    AuditService.log({
      action: 'inventory.transaction_recorded', actor: req.jwtUser, schoolId,
      target: { type: 'inventory_item', id: data.itemId, label: item.name },
      details: { type: data.type, quantity: data.quantity, delta, resultingQuantity: updatedItem.quantity, reason: data.reason },
      ...(data.type === 'adjustment' ? { severity: 'warn' } : {}), req,
    });

    return created(res, plain);
  } catch (err) { console.error('[inventory/transactions POST]', err); return E.serverError(res); }
});

/* ══════════════════════════════════════════════════════════════
   REQUISITIONS + PROCUREMENT
   Requisitions reuse the same configurable Workflow Engine already
   used by Leave/Payroll approval — no bespoke chain logic here, see
   server/utils/workflow-config.js. "Procurement" per the module spec
   ("not another inventory module... the final approval role") is just
   the LAST configured step; there is no separate procurement collection
   or route file. Once a requisition clears every step it becomes
   'approved' and is ready for /fulfill, which is the actual "Receive
   Stock → Inventory Updated" action — a normal 'receive' transaction
   tagged with the requisition it fulfilled.
   ══════════════════════════════════════════════════════════════ */
const REQ_MIN_STEPS = 1; // schools may configure as few as one approver (e.g. just "Procurement")

const RequisitionSchema = z.object({
  itemId:        z.string().optional(),        // omit for a brand-new item not yet in the catalogue
  itemName:      z.string().max(200).optional(), // free-text label when itemId is omitted; denormalized when present
  departmentId:  z.string().optional(),
  departmentName: z.string().max(150).optional(),
  description:   z.string().min(1).max(1000),
  quantity:      z.number().int().positive(),
  unit:          z.string().max(30).trim().default('pcs'),
});

router.get('/requisitions/workflow-config', authMiddleware, PLAN, MODGATE, rbac('inventory', 'update', 'workflow'), async (req, res) => {
  try {
    const { schoolId } = req.jwtUser;
    const config = await getWorkflowConfig(tenantContext(req), schoolId, REQ_WORKFLOW_KEY);
    return ok(res, config || { schoolId, workflowKey: REQ_WORKFLOW_KEY, steps: [], notifyOnly: [] });
  } catch (err) { console.error('[inventory/requisitions/workflow-config GET]', err); return E.serverError(res); }
});

router.put('/requisitions/workflow-config', authMiddleware, PLAN, MODGATE, rbac('inventory', 'update', 'workflow'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { steps, notifyOnly } = req.body;
    const doc = await saveWorkflowConfig(tenantContext(req), schoolId, REQ_WORKFLOW_KEY, { steps, notifyOnly }, userId, REQ_MIN_STEPS);
    return ok(res, doc);
  } catch (err) {
    if (err.statusCode === 400) return E.badRequest(res, err.message);
    console.error('[inventory/requisitions/workflow-config PUT]', err);
    return E.serverError(res);
  }
});

router.get('/requisitions', authMiddleware, PLAN, MODGATE, rbac('inventory', 'read', 'requisition'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { schoolId };
    const _status = strParam(req.query.status);
    if (_status) filter.status = _status;

    // Self-scope to the caller's own requisitions unless they also hold
    // broader inventory access — a requester sees their own requests,
    // not the whole school's queue. Same hasPermission()-based scoping
    // pattern already used by library/hostel/transport's self-view routes.
    const canSeeAll = await hasPermission(req, 'inventory', 'read', 'view');
    if (!canSeeAll) filter.requesterId = userId;

    const Reqs = tenantModel('inventory_requisitions', tenantContext(req));
    const [docs, total] = await Promise.all([
      Reqs.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-__v').lean(),
      Reqs.countDocuments(filter),
    ]);
    return ok(res, docs, paginate(page, limit, total));
  } catch (err) { console.error('[inventory/requisitions GET]', err); return E.serverError(res); }
});

router.post('/requisitions', authMiddleware, PLAN, MODGATE, rbac('inventory', 'create', 'requisition'), async (req, res) => {
  try {
    const { schoolId, userId, name } = req.jwtUser;
    const { data, error } = _validate(RequisitionSchema, req.body);
    if (error) return E.validation(res, error);

    const ctx = tenantContext(req);
    if (data.itemId && !data.itemName) {
      const item = await tenantModel('inventory_items', ctx).findOne({ id: data.itemId, schoolId }).select('name unit').lean();
      if (!item) return E.badRequest(res, 'Unknown itemId.');
      data.itemName = item.name;
      if (!req.body.unit) data.unit = item.unit;
    }
    if (data.departmentId && !data.departmentName) {
      const dept = await tenantModel('departments', ctx).findOne({ id: data.departmentId, schoolId }).select('name').lean();
      if (dept) data.departmentName = dept.name;
    }

    const config = await getWorkflowConfig(ctx, schoolId, REQ_WORKFLOW_KEY);

    const doc = await tenantModel('inventory_requisitions', ctx).create({
      ...data, id: uuidv4(), schoolId,
      requesterId: userId, requesterName: name ?? '',
      status: 'pending', currentStepOrder: config ? 1 : null,
      createdBy: userId, createdAt: new Date().toISOString(),
    });
    const plain = doc.toObject ? doc.toObject() : doc;

    AuditService.log({
      action: 'inventory.requisition_raised', actor: req.jwtUser, schoolId,
      target: { type: 'inventory_requisition', id: plain.id, label: plain.itemName ?? plain.description },
      details: { quantity: plain.quantity, unit: plain.unit }, req,
    });

    if (config) await _notifyStep(req, config.steps[0], plain);

    return created(res, plain);
  } catch (err) { console.error('[inventory/requisitions POST]', err); return E.serverError(res); }
});

function _requisitionSummary(doc) {
  return `Requisition — ${doc.quantity} ${doc.unit} of ${doc.itemName ?? doc.description}, requested by ${doc.requesterName || 'a staff member'}.`;
}

/* In-app system message to the resolved step's eligible approvers —
   best-effort, never blocks the request itself. Same primitive hr.js's
   leave-approval chain already uses (_sendSystemMessage → the messages
   collection), not a new notification channel. */
async function _sendSystemMessage(req, recipientUserId, subject, body) {
  const { schoolId, userId: senderId } = req.jwtUser;
  await tenantModel('messages', tenantContext(req)).create({
    id: uuidv4(), schoolId, senderId, senderName: 'System', senderRole: 'system',
    recipients: [recipientUserId], subject, body, type: 'direct', isRead: {},
    createdAt: new Date().toISOString(),
  });
}

async function _notifyStep(req, step, doc) {
  try {
    const { schoolId } = req.jwtUser;
    const eligible = await resolveStep(tenantContext(req), schoolId, step);
    for (const u of eligible) await _sendSystemMessage(req, u.id, 'Inventory requisition pending your approval', _requisitionSummary(doc));
  } catch (err) { console.error('[inventory/requisitions notify]', err); }
}

/* PATCH /api/inventory/requisitions/:id/advance — approve/reject the
   current chain step. Same shape as hr.js's /leave/:id/advance: no
   rbac() gate here at all — eligibility to act IS being a resolved
   approver for this specific step, a different (narrower, per-instance)
   authorization mechanism than a module-level RBAC grant. */
router.patch('/requisitions/:id/advance', authMiddleware, async (req, res) => { // rbac: workflow-step approver check below
  try {
    const { schoolId, userId, role, email: actorEmail } = req.jwtUser;
    const { status, notes } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return E.badRequest(res, 'status must be "approved" or "rejected"');
    }
    if (status === 'rejected' && !notes?.trim()) {
      return E.badRequest(res, 'A reason is required to reject a requisition');
    }

    const ctx  = tenantContext(req);
    const Reqs = tenantModel('inventory_requisitions', ctx);
    const existing = await Reqs.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Requisition not found');
    if (existing.status !== 'pending') return E.badRequest(res, 'This requisition has already been resolved');

    const config = await getWorkflowConfig(ctx, schoolId, REQ_WORKFLOW_KEY);
    if (!config) return E.badRequest(res, 'No approval chain is configured for this school');

    const stepOrder = existing.currentStepOrder;
    if (!stepOrder || stepOrder > config.steps.length) {
      return E.badRequest(res, 'This requisition is not at a configurable chain step');
    }
    const step = config.steps.find(s => s.order === stepOrder);
    if (!step) return E.serverError(res);

    const eligible = await resolveStep(ctx, schoolId, step);
    if (!eligible.some(u => u.id === userId)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You are not an approver at this step' } });
    }

    const resolvedRoleLabel = await resolveAssigneeLabel(ctx, schoolId, step.assigneeType, step.assigneeValue);
    const actor = { userId, role, email: actorEmail };

    if (status === 'rejected') {
      const doc = await Reqs.findOneAndUpdate(
        { id: req.params.id, schoolId },
        { $set: { status: 'rejected', resolvedBy: userId, resolvedAt: new Date().toISOString(), notes: notes ?? '' } },
        { new: true }
      ).lean();
      AuditService.log({
        action: 'inventory.requisition_step_rejected', actor, schoolId,
        target: { type: 'inventory_requisition', id: doc.id },
        details: { comment: notes ?? '', stepOrder, resolvedRoleLabel }, req,
      });
      return ok(res, doc);
    }

    const nextStepOrder = stepOrder + 1;
    const clearedChain  = nextStepOrder > config.steps.length;
    const doc = await Reqs.findOneAndUpdate(
      { id: req.params.id, schoolId },
      clearedChain
        ? { $set: { status: 'approved', currentStepOrder: nextStepOrder, resolvedBy: userId, resolvedAt: new Date().toISOString() } }
        : { $set: { currentStepOrder: nextStepOrder } },
      { new: true }
    ).lean();

    AuditService.log({
      action: 'inventory.requisition_step_approved', actor, schoolId,
      target: { type: 'inventory_requisition', id: doc.id },
      details: { comment: notes ?? '', stepOrder, resolvedRoleLabel, clearedChain }, req,
    });

    if (!clearedChain) {
      const nextStep = config.steps.find(s => s.order === nextStepOrder);
      if (nextStep) await _notifyStep(req, nextStep, doc);
    }

    return ok(res, doc);
  } catch (err) { console.error('[inventory/requisitions PATCH advance]', err); return E.serverError(res); }
});

/* POST /api/inventory/requisitions/:id/fulfill — "Receive Stock →
   Inventory Updated": creates the actual receive transaction against
   the linked item once the requisition has cleared its full approval
   chain. Gated by the same permission needed to record ANY stock
   transaction (fulfilling one IS creating a receive transaction), not
   tied to the workflow chain itself — the chain decides who APPROVES a
   request, a separate operational permission decides who can actually
   move physical stock. */
router.post('/requisitions/:id/fulfill', authMiddleware, PLAN, MODGATE, rbac('inventory', 'create', 'transact'), async (req, res) => {
  try {
    const { schoolId, userId } = req.jwtUser;
    const ctx  = tenantContext(req);
    const Reqs = tenantModel('inventory_requisitions', ctx);

    const existing = await Reqs.findOne({ id: req.params.id, schoolId }).lean();
    if (!existing) return E.notFound(res, 'Requisition not found');
    if (existing.status !== 'approved') return E.badRequest(res, 'Only an approved requisition can be fulfilled');

    // A requisition raised for a brand-new item (no itemId at creation)
    // must be linked to a real catalogue item at fulfillment time —
    // either one just created via POST /items, or an existing one.
    const itemId = existing.itemId || strParam(req.body.itemId);
    if (!itemId) return E.badRequest(res, 'itemId is required — link this requisition to a catalogue item before fulfilling.');

    const Items = tenantModel('inventory_items', ctx);
    const item  = await Items.findOne({ id: itemId, schoolId }).select('name unit quantity').lean();
    if (!item) return E.badRequest(res, 'Unknown itemId.');

    const delta = existing.quantity;
    const updatedItem = await Items.findOneAndUpdate(
      { id: itemId, schoolId },
      { $inc: { quantity: delta }, $set: { updatedAt: new Date().toISOString() } },
      { new: true }
    ).lean();

    let txnDoc;
    try {
      txnDoc = await tenantModel('inventory_transactions', ctx).create({
        id: uuidv4(), schoolId,
        itemId, itemName: item.name,
        type: 'receive', quantity: existing.quantity, delta,
        reason: `Requisition ${existing.id} fulfilled`,
        requisitionId: existing.id,
        date: new Date().toISOString().slice(0, 10),
        performedBy: userId, createdAt: new Date().toISOString(),
      });
    } catch (ledgerErr) {
      await Items.updateOne({ id: itemId, schoolId }, { $inc: { quantity: -delta } });
      throw ledgerErr;
    }

    const doc = await Reqs.findOneAndUpdate(
      { id: req.params.id, schoolId },
      { $set: { status: 'fulfilled', itemId, itemName: item.name, fulfilledBy: userId, fulfilledAt: new Date().toISOString() } },
      { new: true }
    ).lean();

    AuditService.log({
      action: 'inventory.requisition_fulfilled', actor: req.jwtUser, schoolId,
      target: { type: 'inventory_requisition', id: doc.id, label: item.name },
      details: { quantity: existing.quantity, transactionId: txnDoc.id, resultingQuantity: updatedItem.quantity }, req,
    });

    return ok(res, doc);
  } catch (err) { console.error('[inventory/requisitions POST /:id/fulfill]', err); return E.serverError(res); }
});

module.exports = router;
