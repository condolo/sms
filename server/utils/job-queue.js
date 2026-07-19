/* ============================================================
   Msingi — Job Queue  (C11 Phase 1 / ADR-0006)

   A MongoDB-collection-based retry queue. No Redis/BullMQ — the
   codebase is a single Node process with no external queue infra
   today (docs/governance/PLATFORM_CONCURRENCY_MODEL.md), and nothing
   here justifies adding one. Not the same thing as
   server/utils/email-queue.js, which is a pure in-memory batcher with
   no persistence — this queue is durable (Mongo-backed) and retries
   with backoff.

   Usage:
     const { enqueueJob, registerHandler } = require('./job-queue');
     registerHandler('my_job_type', async (payload) => { ... throw on failure ... });
     await enqueueJob({ type: 'my_job_type', payload: {...} });

   Collection: queue_jobs (platform-level — see utils/tenant-model.js's
   PLATFORM_COLLECTIONS; never scoped via tenantModel()).
   ============================================================ */
'use strict';

const crypto = require('crypto');
const cron   = require('node-cron');
const { _model } = require('./model');

const DEFAULT_MAX_ATTEMPTS = parseInt(process.env.QUEUE_MAX_ATTEMPTS  || '5',       10);
const BASE_DELAY_MS        = parseInt(process.env.QUEUE_RETRY_BASE_MS || '60000',   10); // 1 min
const MAX_DELAY_MS         = parseInt(process.env.QUEUE_RETRY_MAX_MS  || '1800000', 10); // 30 min
const BATCH_SIZE           = parseInt(process.env.QUEUE_BATCH_SIZE    || '10',      10);

const _handlers = new Map();

/** Register the async handler for a job type. Throws to signal failure (triggers retry/dead-letter). */
function registerHandler(type, handlerFn) {
  if (typeof handlerFn !== 'function') {
    throw new Error(`[job-queue] handler for "${type}" must be a function`);
  }
  _handlers.set(type, handlerFn);
}

function _backoff(attempts) {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempts - 1), MAX_DELAY_MS);
  return new Date(Date.now() + delay);
}

/** Enqueue a job. Returns the new job's id. */
async function enqueueJob({ type, payload, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
  if (!type) throw new Error('[job-queue] enqueueJob requires a type');
  const now = new Date();
  const QueueJobs = _model('queue_jobs');
  const doc = await QueueJobs.create({
    id: `job_${crypto.randomUUID()}`,
    type,
    payload: payload ?? null,
    status: 'pending',
    attempts: 0,
    maxAttempts,
    nextAttemptAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
  return doc.id;
}

/**
 * Claim and process up to `batchSize` due jobs. Every DB call and every
 * handler invocation is individually try/caught — one bad job can never
 * stop the batch or escape to the caller (matches AuditService.log()'s
 * "must never break other work" discipline).
 */
async function processQueueOnce({ batchSize = BATCH_SIZE } = {}) {
  const QueueJobs = _model('queue_jobs');
  const now = new Date();
  const stats = { claimed: 0, succeeded: 0, retried: 0, deadLettered: 0 };

  const candidates = await QueueJobs
    .find({ status: 'pending', nextAttemptAt: { $lte: now } })
    .sort({ nextAttemptAt: 1 })
    .limit(batchSize)
    .select('_id')
    .lean();

  for (const { _id } of candidates) {
    let job;
    try {
      // Atomic claim — re-checks status so a concurrent claimant can never
      // process the same job twice. {new:true} is required here (unlike
      // mpesa.js's similar-looking claim) because the handler needs the
      // post-update doc's payload/type/attempts, not just a match/no-match signal.
      job = await QueueJobs.findOneAndUpdate(
        { _id, status: 'pending' },
        { $set: { status: 'processing', updatedAt: new Date() } },
        { new: true },
      ).lean();
    } catch (err) {
      console.error('[job-queue] claim failed for', _id, err.message);
      continue;
    }
    if (!job) continue; // lost the race — another claimant got it first

    stats.claimed++;

    try {
      const handler = _handlers.get(job.type);
      if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
      await handler(job.payload, job);
      await QueueJobs.updateOne(
        { _id: job._id },
        { $set: { status: 'completed', completedAt: new Date(), updatedAt: new Date() }, $unset: { lastError: '' } },
      );
      stats.succeeded++;
    } catch (err) {
      const attempts = (job.attempts || 0) + 1;
      const dead      = attempts >= (job.maxAttempts || DEFAULT_MAX_ATTEMPTS);
      const errMsg    = String((err && err.message) || err);
      try {
        await QueueJobs.updateOne(
          { _id: job._id },
          dead
            ? { $set: { status: 'dead_letter', attempts, lastError: errMsg, updatedAt: new Date() } }
            : { $set: { status: 'pending', attempts, lastError: errMsg, nextAttemptAt: _backoff(attempts), updatedAt: new Date() } },
        );
      } catch (writeErr) {
        console.error('[job-queue] failed to record failure for', job._id, writeErr.message);
      }
      dead ? stats.deadLettered++ : stats.retried++;
      console.error(`[job-queue] job ${job.type}/${job.id} failed (attempt ${attempts}/${job.maxAttempts}):`, errMsg);
    }
  }

  return stats;
}

let _isRunning = false;
function startQueueWorker() {
  const expr = process.env.QUEUE_WORKER_CRON || '*/1 * * * *';
  if (!cron.validate(expr)) {
    console.error(`[job-queue] Invalid cron expression: ${expr}`);
    return;
  }
  cron.schedule(expr, async () => {
    // Overlap guard — a per-minute worker is a new situation in this
    // codebase (every other cron file here runs daily/weekly and never
    // needed one); a slow tick must not run concurrently with the next.
    if (_isRunning) {
      console.warn('[job-queue] previous tick still running — skipping this one');
      return;
    }
    _isRunning = true;
    try {
      await processQueueOnce();
    } catch (err) {
      console.error('[job-queue] worker tick failed:', err.message);
    } finally {
      _isRunning = false;
    }
  }, { timezone: 'UTC' });
  console.log(`[job-queue] worker scheduled: ${expr}`);
}

module.exports = { enqueueJob, registerHandler, processQueueOnce, startQueueWorker };
