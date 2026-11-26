'use strict';

jest.mock('worker_threads', () => {
  const { EventEmitter } = require('events');
  class MockWorker extends EventEmitter {
    constructor(filename) {
      super();
      this.filename = filename;
      this.posted = [];
      (globalThis.__mockWorkers ||= []).push(this);
    }
    postMessage(message) { this.posted.push(message); }
    terminate() {
      setImmediate(() => this.emit('exit', 0));
      return Promise.resolve(0);
    }
  }
  return { Worker: MockWorker };
});

describe('passwordHash worker failures', () => {
  let closePool;

  beforeEach(() => {
    globalThis.__mockWorkers = [];
    process.env.AUTH_HASH_MODE = 'worker';
    process.env.AUTH_HASH_POOL_SIZE = '1';
    process.env.AUTH_HASH_MAX_QUEUE = '1';
    jest.resetModules();
    ({ closePool } = require('../../../server/services/passwordHash'));
  });

  afterEach(async () => {
    if (closePool) await closePool();
    delete process.env.AUTH_HASH_MODE;
    delete process.env.AUTH_HASH_POOL_SIZE;
    delete process.env.AUTH_HASH_MAX_QUEUE;
  });

  test('a worker error rejects its task and spawns a replacement', async () => {
    const { comparePassword, PasswordHashInfrastructureError } = require('../../../server/services/passwordHash');
    const pending = comparePassword('pw', 'hash');
    await new Promise(resolve => setImmediate(resolve));

    expect(globalThis.__mockWorkers).toHaveLength(1);
    globalThis.__mockWorkers[0].emit('error', new Error('worker exploded'));

    await expect(pending).rejects.toThrow('worker exploded');
    await new Promise(resolve => setImmediate(resolve));
    expect(globalThis.__mockWorkers.length).toBeGreaterThan(1);
  });

  test('a worker failure message rejects as an infrastructure error', async () => {
    const { comparePassword, PasswordHashInfrastructureError } = require('../../../server/services/passwordHash');
    const pending = comparePassword('pw', 'hash');
    await new Promise(resolve => setImmediate(resolve));

    const worker = globalThis.__mockWorkers[0];
    const message = worker.posted.shift();
    worker.emit('message', { id: message.id, ok: false, error: 'worker compare failed' });

    await expect(pending).rejects.toBeInstanceOf(PasswordHashInfrastructureError);
  });

  test('queue overflow is rejected before another task is enqueued', async () => {
    const { comparePassword } = require('../../../server/services/passwordHash');
    const first = comparePassword('pw', 'hash');
    const second = comparePassword('pw', 'hash');

    await expect(comparePassword('pw', 'hash')).rejects.toThrow('Authentication is busy');

    const worker = globalThis.__mockWorkers[0];
    const firstMessage = worker.posted.shift();
    worker.emit('message', { id: firstMessage.id, ok: true, value: true });
    await expect(first).resolves.toBe(true);

    const secondMessage = worker.posted.shift();
    worker.emit('message', { id: secondMessage.id, ok: true, value: true });
    await expect(second).resolves.toBe(true);
  });
});
