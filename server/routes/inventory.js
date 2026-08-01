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
const { rbac }           = require('../middleware/rbac');
const { planGate }       = require('../middleware/plan');
const { tenantModel, tenantContext } = require('../utils/tenant-model');
const { ok, created, paginate, parsePagination, E, strParam } = require('../utils/response');
const AuditService = require('../services/audit');

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

module.exports = router;
