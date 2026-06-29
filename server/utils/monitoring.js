/* ============================================================
   Msingi — Monitoring & Error Tracking

   Three-layer error capture strategy:
   1. Local rotating log file  — always active, no config needed
      Written to: ERROR_LOG_DIR env var, default <project>/logs/
   2. Sentry (optional)        — active when SENTRY_DSN is set
      AND @sentry/node is installed (npm install @sentry/node)
   3. Alert webhook (optional) — active when ALERT_WEBHOOK_URL is set
      Supports any POST endpoint: Discord, Slack, custom receiver

   Usage in server/index.js:
     const monitoring = require('./utils/monitoring');
     monitoring.init();                         // call once, before routes
     app.use(monitoring.requestHandler());      // after CORS
     app.use(monitoring.errorHandler());        // before final error handler
     // In the final error handler:
     monitoring.captureException(err);

   Environment variables:
     SENTRY_DSN          — Sentry DSN string (get from sentry.io)
     ALERT_WEBHOOK_URL   — Webhook URL for error alerts (Discord/Slack/etc.)
     ERROR_LOG_DIR       — Directory for error log files (default: logs/)
   ============================================================ */
'use strict';

const fs   = require('fs');
const path = require('path');

const DSN           = process.env.SENTRY_DSN           || '';
const ALERT_WEBHOOK = process.env.ALERT_WEBHOOK_URL    || '';
const LOG_DIR       = process.env.ERROR_LOG_DIR
  ? path.resolve(process.env.ERROR_LOG_DIR)
  : path.join(__dirname, '../../logs');

let _sentry = null;

/* ── Sentry initialisation (optional dependency) ──────────── */
function _trySentry() {
  if (!DSN) return null;
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn:               DSN,
      environment:       process.env.NODE_ENV || 'development',
      tracesSampleRate:  0.1,   // 10% transaction sampling
    });
    console.log('[monitoring] Sentry initialised');
    return Sentry;
  } catch (_) {
    console.warn('[monitoring] @sentry/node not installed — to enable Sentry run: npm install @sentry/node');
    return null;
  }
}

/* ── Rotating file logger ───────────────────────────────────── */
function _writeLog(entry) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(LOG_DIR, `errors-${date}.log`);
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (_) { /* non-fatal */ }
}

/* ── Webhook alert (Discord/Slack/custom POST endpoint) ────── */
function _sendWebhook(entry) {
  if (!ALERT_WEBHOOK) return;
  try {
    const https = require('https');
    const http  = require('http');
    const body  = JSON.stringify({
      content: `🚨 **Msingi Server Error**\n` +
               `\`${entry.message || 'Unknown error'}\`\n` +
               (entry.stack ? `\`\`\`\n${entry.stack.slice(0, 800)}\n\`\`\`` : '') +
               `\n*Route:* ${entry.route || 'N/A'}  |  *Time:* ${entry.timestamp}`,
    });
    let url;
    try { url = new URL(ALERT_WEBHOOK); } catch (_) { return; }

    const lib  = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = lib.request(opts, (res) => { res.resume(); });
    req.on('error', () => { /* non-fatal */ });
    req.write(body);
    req.end();
  } catch (_) { /* non-fatal */ }
}

/* ── Public API ─────────────────────────────────────────────── */

/**
 * Capture an exception: write to log file, optionally report to Sentry
 * and/or send a webhook alert.
 *
 * @param {Error | unknown} err
 * @param {{ route?: string, userId?: string, schoolId?: string }} [ctx]
 */
function captureException(err, ctx = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    message:   err?.message || String(err),
    stack:     err?.stack   || '',
    ...ctx,
  };
  _writeLog(entry);
  if (_sentry) {
    try { _sentry.captureException(err); } catch (_) { /* non-fatal */ }
  }
  _sendWebhook(entry);
}

/**
 * Initialise monitoring. Call once at startup, before the server listens.
 * Wires global uncaughtException and unhandledRejection handlers.
 */
function init() {
  _sentry = _trySentry();

  // Global process error handlers — catch anything that slips past Express
  process.on('uncaughtException', (err) => {
    console.error('[monitoring] ⚠️  uncaughtException:', err);
    captureException(err, { route: 'uncaughtException' });
    // Give Sentry/webhook time to flush, then crash (Node convention)
    setTimeout(() => process.exit(1), 1000).unref();
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[monitoring] ⚠️  unhandledRejection:', err);
    captureException(err, { route: 'unhandledRejection' });
  });

  const channels = [];
  if (_sentry)        channels.push('Sentry');
  if (ALERT_WEBHOOK)  channels.push('webhook');
  channels.push('disk');   // always active

  console.log(`[monitoring] Active — channels: ${channels.join(', ')}. Log dir: ${LOG_DIR}`);
}

/**
 * Express request middleware (Sentry request context, if available).
 * Place after CORS, before routes.
 */
function requestHandler() {
  // Sentry v7 API — gracefully skipped if not installed / wrong version
  if (_sentry?.Handlers?.requestHandler) {
    return _sentry.Handlers.requestHandler();
  }
  return (_req, _res, next) => next();
}

/**
 * Express error middleware for Sentry (captures req context automatically).
 * Place BEFORE the final error handler so Sentry gets the full context.
 */
function errorHandler() {
  if (_sentry?.Handlers?.errorHandler) {
    return _sentry.Handlers.errorHandler();
  }
  // Passthrough — must accept 4 args so Express treats it as an error handler
  // eslint-disable-next-line no-unused-vars
  return (err, _req, _res, next) => next(err);
}

module.exports = { init, captureException, requestHandler, errorHandler };
