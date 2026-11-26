'use strict';

/**
 * The worker pool is the production path (NODE_ENV !== 'test'). Force it on
 * here so a regression in worker startup, messaging or result mapping cannot
 * hide behind the inline path Jest normally uses.
 */

describe('passwordHash worker pool', () => {
  let bcrypt;
  let comparePassword;
  let closePool;
  let hash;

  beforeAll(async () => {
    process.env.AUTH_HASH_MODE = 'worker';
    jest.resetModules();
    bcrypt = require('bcryptjs');
    ({ comparePassword, warmPool, closePool } = require('../../../server/services/passwordHash'));
    warmPool();
    hash = await bcrypt.hash('correct horse battery staple', 4);
  });

  afterAll(async () => {
    delete process.env.AUTH_HASH_MODE;
    if (closePool) await closePool();
  });

  test('compares many passwords concurrently in workers', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => comparePassword('correct horse battery staple', hash)),
    );
    expect(results).toEqual(Array(10).fill(true));
  });

  test('returns false for a wrong password', async () => {
    await expect(comparePassword('wrong password', hash)).resolves.toBe(false);
  });
});
