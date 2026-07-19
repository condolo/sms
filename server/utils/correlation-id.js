/* ============================================================
   Msingi — Correlation ID  (C5 / MR-002)

   Assigns every incoming request a correlation ID so multiple
   AuditService.log() entries produced by one request (and any
   console.error output alongside them) can be traced back to the
   same request. Write-side/internal-tracing concern only — no
   response header is echoed back to the client (see ADR/plan notes
   for why: PLATFORM_ARCHITECTURE_EVOLUTION_v1.md's Security
   Invariant 12 is a requirement on audit *records*, not on the
   client-facing response contract).
   ============================================================ */
'use strict';

const crypto = require('crypto');

// Bounded length, safe charset — defends against an untrusted client
// supplying an oversized or log-injection-shaped x-request-id header.
const SAFE_ID_RE = /^[\w-]{1,100}$/;

/**
 * Resolve the correlation ID for a request: reuse an incoming
 * x-request-id/x-correlation-id header if present and shape-safe,
 * otherwise generate a fresh one.
 */
function resolveCorrelationId(req) {
  const incoming = req?.headers?.['x-request-id'] ?? req?.headers?.['x-correlation-id'];
  if (typeof incoming === 'string' && SAFE_ID_RE.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}

function correlationIdMiddleware(req, res, next) {
  req.correlationId = resolveCorrelationId(req);
  next();
}

module.exports = { resolveCorrelationId, correlationIdMiddleware };
