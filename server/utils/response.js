/* ============================================================
   InnoLearn — Standardised API Response Helpers

   All API responses follow one of two envelopes:

   Success:
   {
     success: true,
     data: <any>,
     pagination: { page, limit, total, pages }  // only on paginated lists
   }

   Failure:
   {
     success: false,
     error: {
       code: "ERROR_CODE",
       message: "Human-readable message",
       ...extra fields
     }
   }
   ============================================================ */

/**
 * Send a successful response.
 *
 * @param {import('express').Response} res
 * @param {any}    data        - Payload to send
 * @param {object} [pagination] - Optional pagination meta
 * @param {number} [status=200]
 */
function ok(res, data, pagination = null, status = 200) {
  const body = { success: true, data };
  if (pagination) body.pagination = pagination;
  return res.status(status).json(body);
}

/**
 * Send a created (201) response.
 */
function created(res, data) {
  return ok(res, data, null, 201);
}

/**
 * Send an error response.
 *
 * @param {import('express').Response} res
 * @param {string} code     - Machine-readable error code, e.g. 'NOT_FOUND'
 * @param {string} message  - Human-readable message
 * @param {number} [status=400]
 * @param {object} [extra]  - Additional fields to merge into error object
 */
function fail(res, code, message, status = 400, extra = {}) {
  return res.status(status).json({
    success: false,
    error: { code, message, ...extra }
  });
}

/**
 * Build a pagination meta object.
 *
 * @param {number} page    - Current page (1-based)
 * @param {number} limit   - Items per page
 * @param {number} total   - Total matching documents
 */
function paginate(page, limit, total) {
  return {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit) || 1
  };
}

/**
 * Parse and validate pagination query params with safe defaults.
 * Returns { page, limit, skip }.
 */
function parsePagination(query) {
  const page  = Math.max(1, parseInt(query.page)  || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit) || 50));
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
}

/**
 * Common error shortcuts.
 */
const E = {
  notFound:      (res, msg = 'Resource not found')     => fail(res, 'NOT_FOUND', msg, 404),
  forbidden:     (res, msg = 'Access denied')           => fail(res, 'FORBIDDEN', msg, 403),
  unauthorized:  (res, msg = 'Authentication required') => fail(res, 'UNAUTHENTICATED', msg, 401),
  badRequest:    (res, msg = 'Bad request')             => fail(res, 'BAD_REQUEST', msg, 400),
  conflict:      (res, msg = 'Resource already exists') => fail(res, 'CONFLICT', msg, 409),
  serverError:   (res, msg = 'Internal server error')   => fail(res, 'SERVER_ERROR', msg, 500),
  validation:    (res, issues)                          => fail(res, 'VALIDATION_ERROR', 'Validation failed', 422, { issues }),
};

module.exports = { ok, created, fail, paginate, parsePagination, E };
