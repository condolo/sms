/* ============================================================
   Optimistic Concurrency Control — shared utility
   ============================================================
   Wraps findOneAndUpdate to detect and surface version conflicts.

   PATTERN:
     Every mutable document carries a numeric _v field (version).
     On each write, _v is incremented atomically.
     If the client sends a _v that doesn't match the DB value,
     the update filter won't match → we detect it and return 409.

   BACKWARD COMPATIBILITY:
     If the client omits _v (or sends null/undefined), the update
     proceeds without version checking. This keeps old API clients
     working while newer clients opt in to conflict detection.

   USAGE in a route handler:
     const { doc, conflict } = await applyOptimisticLock(
       _model('students'),
       { id: req.params.id, schoolId },
       { firstName: 'Ada', updatedBy: userId },
       req.body._v          // undefined = skip check
     );
     if (conflict)       return E.conflict(res, 'This record was edited by another user. Please refresh and try again.');
     if (!doc)           return E.notFound(res, 'Record not found');
     return ok(res, doc);
   ============================================================ */

/**
 * Perform a findOneAndUpdate with optional optimistic version checking.
 *
 * @param {import('mongoose').Model} Model
 * @param {object} baseFilter   — filter WITHOUT _v (e.g. { id, schoolId })
 * @param {object} updateFields — plain object of fields to $set; DO NOT wrap in $set yourself
 * @param {number|string|null|undefined} clientVersion — the _v value the client read; omit to skip check
 * @returns {{ doc: object|null, conflict: boolean }}
 *   doc      — the updated document (lean), or null if not found / version mismatch
 *   conflict — true only when the record exists but _v didn't match
 */
async function applyOptimisticLock(Model, baseFilter, updateFields, clientVersion) {
  const hasVersion = clientVersion != null && clientVersion !== '';

  // Build the filter: include _v only when client sent it
  const filter = hasVersion
    ? { ...baseFilter, _v: Number(clientVersion) }
    : baseFilter;

  // Always $set user fields; always $inc _v so every write bumps it
  const updateOp = {
    $set: updateFields,
    $inc: { _v: 1 },
  };

  const doc = await Model.findOneAndUpdate(filter, updateOp, {
    new: true,
    runValidators: false,
  }).lean();

  if (doc) return { doc, conflict: false };

  if (hasVersion) {
    // Distinguish: did the record not exist at all, or did the version not match?
    const exists = await Model.exists(baseFilter);
    if (exists) {
      return { doc: null, conflict: true };
    }
  }

  return { doc: null, conflict: false };
}

module.exports = { applyOptimisticLock };
