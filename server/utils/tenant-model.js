/* ============================================================
   Msingi — Tenant-Scoped Data Accessor  (C4 · ADR-0001)

   Structural tenant enforcement. Where `_model(collection)` returns a
   bare Mongoose model that will run ANY filter a caller hands it,
   `tenantModel(collection, ctx)` returns a wrapper that force-scopes
   every query to the validated tenant context — the caller never
   supplies schoolId, so the caller can't get it wrong.

   HONEST SCOPE (ADR-0001 §4): this is defense-in-depth, NOT an absolute
   guarantee. It cannot reach:
     • .populate() cross-collection pulls
     • raw driver access (mongoose.connection.db.collection(...))
     • transactions dropping to the raw session API
   Those remain reviewed exceptions, and the cross-tenant regression
   suite is the backstop for them. Do not describe this as "impossible
   to leak" — describe it as "progressively harder to leak."

   ADOPTION: ships alongside _model(); nothing is forced to migrate.
   Routes adopt it incrementally, highest-risk first, each change
   independently testable and reversible (ADR-0001 §6).
   ============================================================ */
'use strict';

const { _model } = require('./model');

/* Platform/org-level collections that legitimately carry no schoolId.
   These must be accessed via _model() directly — never tenantModel().
   `users` is deliberately NOT here: it stays tenant-scoped until D-001
   decides identity scope (ADR-0001 §3). */
const PLATFORM_COLLECTIONS = new Set([
  'schools',
  'organizations',
  'release_certificates',
  'audit_logs',
  'platform_settings',    // singleton config doc (id:'global'), no schoolId concept
  'landing_content',      // singleton CMS doc (id:'global'), no schoolId concept
  'system_announcements', // platform-wide notices shown on every school's dashboard
]);

/* ── Tenant context ─────────────────────────────────────────────
   The validated, singular tenant context for a request. Today just
   { schoolId }; designed to grow to { schoolId, membershipId,
   organizationId } as the membership model lands, without changing
   consumers. Derived only from the already-trusted JWT. */
function tenantContext(req) {
  const schoolId = req && req.jwtUser ? (req.jwtUser.schoolId ?? null) : null;
  return schoolId ? { schoolId } : null;
}

/* Optional middleware form — sets req.tenantContext. Wired per-route
   during incremental adoption; does not fail closed here (a platform or
   public route legitimately has no tenant). Enforcement lives in
   tenantModel(), which throws when asked to scope without a context. */
function tenantContextMiddleware(req, _res, next) {
  req.tenantContext = tenantContext(req);
  next();
}

/* ── Scoping helpers ────────────────────────────────────────── */
function _scopedFilter(filter, schoolId, collection) {
  const f = filter ? { ...filter } : {};
  if (f.schoolId != null && f.schoolId !== schoolId) {
    throw new Error(`[tenantModel] filter schoolId '${f.schoolId}' conflicts with tenant context '${schoolId}' on '${collection}'`);
  }
  f.schoolId = schoolId;
  return f;
}

function _scopedDoc(doc, schoolId, collection) {
  if (Array.isArray(doc)) return doc.map(d => _scopedDoc(d, schoolId, collection));
  const d = doc ? { ...doc } : {};
  if (d.schoolId != null && d.schoolId !== schoolId) {
    throw new Error(`[tenantModel] document schoolId '${d.schoolId}' conflicts with tenant context '${schoolId}' on '${collection}'`);
  }
  d.schoolId = schoolId;
  return d;
}

/* Prevent tenant-hopping via an update payload that rewrites schoolId. */
function _guardUpdate(update, schoolId, collection) {
  if (!update || typeof update !== 'object') return update;
  const offenders = [update.schoolId, update.$set && update.$set.schoolId, update.$setOnInsert && update.$setOnInsert.schoolId];
  for (const v of offenders) {
    if (v != null && v !== schoolId) {
      throw new Error(`[tenantModel] update attempts to set schoolId '${v}' ≠ tenant context '${schoolId}' on '${collection}' (tenant-hop blocked)`);
    }
  }
  return update;
}

function _scopedPipeline(pipeline, schoolId, collection) {
  const p = Array.isArray(pipeline) ? pipeline : [];
  const first = p[0];
  if (first && first.$match && first.$match.schoolId != null && first.$match.schoolId !== schoolId) {
    throw new Error(`[tenantModel] aggregate $match schoolId '${first.$match.schoolId}' conflicts with tenant context '${schoolId}' on '${collection}'`);
  }
  return [{ $match: { schoolId } }, ...p];
}

function _scopedBulk(ops, schoolId, collection) {
  return (ops || []).map(op => {
    const kind = Object.keys(op)[0];   // updateOne | updateMany | insertOne | deleteOne | deleteMany | replaceOne
    const body = { ...op[kind] };
    if (body.filter)      body.filter      = _scopedFilter(body.filter, schoolId, collection);
    if (body.document)    body.document    = _scopedDoc(body.document, schoolId, collection);
    if (body.replacement) body.replacement = _scopedDoc(body.replacement, schoolId, collection);
    if (body.update)      body.update      = _guardUpdate(body.update, schoolId, collection);
    return { [kind]: body };
  });
}

/* ── The wrapper ────────────────────────────────────────────────
   Each method transforms its tenant-relevant argument and delegates to
   the real Mongoose model, returning exactly what Mongoose returns — so
   query chaining (.lean(), .sort(), .select(), .cursor(), …) is
   preserved untouched. */
function _wrap(model, schoolId, collection) {
  return {
    find:             (filter, ...rest) => model.find(_scopedFilter(filter, schoolId, collection), ...rest),
    findOne:          (filter, ...rest) => model.findOne(_scopedFilter(filter, schoolId, collection), ...rest),
    countDocuments:   (filter, ...rest) => model.countDocuments(_scopedFilter(filter, schoolId, collection), ...rest),
    exists:           (filter, ...rest) => model.exists(_scopedFilter(filter, schoolId, collection), ...rest),
    distinct:         (field, filter, ...rest) => model.distinct(field, _scopedFilter(filter, schoolId, collection), ...rest),
    deleteOne:        (filter, ...rest) => model.deleteOne(_scopedFilter(filter, schoolId, collection), ...rest),
    deleteMany:       (filter, ...rest) => model.deleteMany(_scopedFilter(filter, schoolId, collection), ...rest),
    updateOne:        (filter, update, ...rest) => model.updateOne(_scopedFilter(filter, schoolId, collection), _guardUpdate(update, schoolId, collection), ...rest),
    updateMany:       (filter, update, ...rest) => model.updateMany(_scopedFilter(filter, schoolId, collection), _guardUpdate(update, schoolId, collection), ...rest),
    findOneAndUpdate: (filter, update, ...rest) => model.findOneAndUpdate(_scopedFilter(filter, schoolId, collection), _guardUpdate(update, schoolId, collection), ...rest),
    findOneAndDelete: (filter, ...rest) => model.findOneAndDelete(_scopedFilter(filter, schoolId, collection), ...rest),
    create:           (doc, ...rest) => model.create(_scopedDoc(doc, schoolId, collection), ...rest),
    insertMany:       (docs, ...rest) => model.insertMany(_scopedDoc(docs, schoolId, collection), ...rest),
    aggregate:        (pipeline, ...rest) => model.aggregate(_scopedPipeline(pipeline, schoolId, collection), ...rest),
    bulkWrite:        (ops, ...rest) => model.bulkWrite(_scopedBulk(ops, schoolId, collection), ...rest),

    /* Audited escape hatch to the raw model for the reviewed exceptions
       in ADR-0001 §4 (e.g. a populate target). Named `_raw` so it is
       greppable in review and flagged by the CI lint. */
    _raw: model,
  };
}

/**
 * tenantModel(collection, ctx) — tenant-scoped accessor.
 * @param {string} collection  a tenant-owned collection name
 * @param {{schoolId:string}} ctx  validated tenant context
 * @throws if collection is platform-level, or ctx lacks schoolId (fail-closed)
 */
function tenantModel(collection, ctx) {
  if (PLATFORM_COLLECTIONS.has(collection)) {
    throw new Error(`[tenantModel] '${collection}' is platform-level — use _model() directly, not tenantModel()`);
  }
  const schoolId = ctx && ctx.schoolId;
  if (!schoolId) {
    throw new Error(`[tenantModel] refusing to query '${collection}' without a validated tenant context (schoolId). Fail-closed.`);
  }
  return _wrap(_model(collection), schoolId, collection);
}

module.exports = {
  tenantModel,
  tenantContext,
  tenantContextMiddleware,
  PLATFORM_COLLECTIONS,
};
