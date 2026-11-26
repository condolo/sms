'use strict';

/**
 * bcryptjs is pure JavaScript and runs its rounds on the Node event loop. Ten
 * simultaneous password logins therefore serialize into ~10s wall time even
 * on an 8-core box. Keep comparisons in a bounded worker pool so the API can
 * still answer health checks, OTP requests and other traffic while hashes run.
 *
 * Tests and single-process scripts can force the inline path with
 * AUTH_HASH_INLINE=1. Production uses workers when worker_threads is available.
 */

const bcrypt = require('bcryptjs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

const inline = process.env.AUTH_HASH_MODE === 'worker'
  ? false
  : process.env.NODE_ENV === 'test' || process.env.AUTH_HASH_INLINE === '1';
const cpuCount = os.availableParallelism?.() || os.cpus()?.length || 2;
const configuredPool = Number(process.env.AUTH_HASH_POOL_SIZE);
const configuredQueue = Number(process.env.AUTH_HASH_MAX_QUEUE);
const poolSize = Number.isInteger(configuredPool) && configuredPool > 0
  ? Math.min(configuredPool, 32)
  : Math.max(1, Math.min(6, cpuCount - 1));
const maxQueued = Number.isInteger(configuredQueue) && configuredQueue >= 1
  ? Math.min(configuredQueue, 1000)
  : 200;
let closing = false;
let closePromise = null;

class PasswordHashInfrastructureError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'PasswordHashInfrastructureError';
  }
}

const idle = [];
const queue = [];
const workers = new Set();
let nextId = 0;

function spawnWorker() {
  const entry = { worker: null, task: null };
  const worker = new Worker(path.join(__dirname, 'passwordHashWorker.js'));
  entry.worker = worker;
  workers.add(entry);

  worker.on('message', (message) => {
    const task = entry.task;
    entry.task = null;
    if (task) {
      if (message.ok) task.resolve(Boolean(message.value));
      else task.reject(new PasswordHashInfrastructureError(message.error || 'Password comparison failed'));
    }
    if (idle.includes(entry)) return;
    idle.push(entry);
    drain();
  });

  worker.on('error', (error) => {
    const task = entry.task;
    entry.task = null;
    workers.delete(entry);
    const idleIndex = idle.indexOf(entry);
    if (idleIndex >= 0) idle.splice(idleIndex, 1);
    if (task) task.reject(error instanceof PasswordHashInfrastructureError
      ? error
      : new PasswordHashInfrastructureError(error?.message || 'Password worker failed', { cause: error }));
    if (!closing && workers.size < poolSize) spawnWorker();
    drain();
  });

  worker.on('exit', () => {
    const task = entry.task;
    entry.task = null;
    workers.delete(entry);
    const idleIndex = idle.indexOf(entry);
    if (idleIndex >= 0) idle.splice(idleIndex, 1);
    if (task) task.reject(new PasswordHashInfrastructureError('Password worker exited before completing'));
    if (!closing && workers.size < poolSize) spawnWorker();
    drain();
  });

  idle.push(entry);
  return entry;
}

function drain() {
  while (queue.length > 0 && idle.length > 0) {
    const entry = idle.shift();
    const task = queue.shift();
    if (!entry || !task) return;
    entry.task = task;
    entry.worker.postMessage({ id: task.id, password: task.password, hash: task.hash });
  }
}

function compareInline(password, hash) {
  return bcrypt.compare(password, hash);
}

function compareInWorker(password, hash) {
  if (closing || queue.length >= maxQueued) {
    return Promise.reject(new PasswordHashInfrastructureError('Authentication is busy. Please try again shortly.'));
  }
  return new Promise((resolve, reject) => {
    const task = { id: ++nextId, password, hash, resolve, reject };
    queue.push(task);
    while (workers.size < poolSize) spawnWorker();
    drain();
  });
}

function comparePassword(password, hash) {
  return inline ? compareInline(password, hash) : compareInWorker(password, hash);
}

function closePool() {
  if (closePromise) return closePromise;
  closing = true;
  while (queue.length) queue.shift().reject(new PasswordHashInfrastructureError('Password pool closed'));

  const entries = [...workers];
  workers.clear();
  idle.length = 0;
  closePromise = Promise.all(entries.map(entry => new Promise(resolve => {
    const task = entry.task;
    entry.task = null;
    if (task) task.reject(new PasswordHashInfrastructureError('Password pool closed'));
    entry.worker.once('exit', resolve);
    entry.worker.terminate().then(resolve, resolve);
  })));
  return closePromise;
}

module.exports = { comparePassword, closePool, PasswordHashInfrastructureError };
