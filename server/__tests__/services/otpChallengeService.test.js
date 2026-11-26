'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const {
  claimEmailCode,
  consumeEmailCode,
} = require('../../services/otpChallengeService');

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'auth_otp_test' });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('otp_challenges').deleteMany({});
});

const accounts = [
  { schoolId: 'sch_a', userId: 'usr_a' },
  { schoolId: 'sch_b', userId: 'usr_b' },
];

test('ten concurrent sends create one inbox challenge', async () => {
  const sentAt = new Date();
  const results = await Promise.all(Array.from({ length: 10 }, () => claimEmailCode(
    'parent@example.com',
    accounts,
    { codeHash: 'hash', expiresAt: new Date(sentAt.getTime() + 600000), sentAt },
  )));

  expect(results.filter(Boolean)).toHaveLength(1);
  const stored = await mongoose.connection.collection('otp_challenges').findOne({ _id: 'parent@example.com' });
  expect(stored.sendTimes).toHaveLength(1);
  expect(stored.expiresAt).toBeInstanceOf(Date);
});

test('one challenge can be consumed only once across all school copies', async () => {
  const sentAt = new Date();
  await claimEmailCode('parent@example.com', accounts, {
    codeHash: 'hash', expiresAt: new Date(sentAt.getTime() + 600000), sentAt,
  });

  const results = await Promise.all([
    consumeEmailCode('parent@example.com', 'hash'),
    consumeEmailCode('parent@example.com', 'hash'),
  ]);

  expect(results.filter(Boolean)).toHaveLength(1);
  expect(results.find(Boolean).accounts).toEqual(accounts);
});

test('resend window and hourly cap are enforced from current database state', async () => {
  const sentAt = new Date();
  await claimEmailCode('parent@example.com', accounts, {
    codeHash: 'hash', expiresAt: new Date(sentAt.getTime() + 600000), sentAt,
  });
  await expect(claimEmailCode('parent@example.com', accounts, {
    codeHash: 'hash2', expiresAt: new Date(sentAt.getTime() + 600000), sentAt,
  })).resolves.toBeNull();

  const recent = Array.from({ length: 5 }, (_, i) => new Date(Date.now() - (i + 1) * 60 * 1000));
  await mongoose.connection.collection('otp_challenges').updateOne(
    { _id: 'parent@example.com' },
    { $set: { lastSentAt: new Date(Date.now() - 5 * 60 * 1000), sendTimes: recent } },
  );
  await expect(claimEmailCode('parent@example.com', accounts, {
    codeHash: 'hash2', expiresAt: new Date(sentAt.getTime() + 600000), sentAt,
  })).resolves.toBeNull();
});

test('a valid challenge for school A cannot be burned through school C', async () => {
  const sentAt = new Date();
  await claimEmailCode('parent@example.com', accounts, {
    codeHash: 'hash', expiresAt: new Date(sentAt.getTime() + 600000), sentAt,
  });

  await expect(consumeEmailCode('parent@example.com', 'hash', { schoolId: 'sch_c' })).resolves.toBeNull();
  const stored = await mongoose.connection.collection('otp_challenges').findOne({ _id: 'parent@example.com' });
  expect(stored.consumedAt).toBeUndefined();
  await expect(consumeEmailCode('parent@example.com', 'hash', { schoolId: 'sch_a' })).resolves.toBeTruthy();
});

test('a wrong code increments attempts without consuming the challenge', async () => {
  const sentAt = new Date();
  await claimEmailCode('parent@example.com', accounts, {
    codeHash: 'hash', expiresAt: new Date(sentAt.getTime() + 600000), sentAt,
  });

  await expect(consumeEmailCode('parent@example.com', 'wrong')).resolves.toBeNull();
  const stored = await mongoose.connection.collection('otp_challenges').findOne({ _id: 'parent@example.com' });
  expect(stored.attempts).toBe(1);
  expect(stored.consumedAt).toBeUndefined();
  await expect(consumeEmailCode('parent@example.com', 'hash')).resolves.toBeTruthy();
});
