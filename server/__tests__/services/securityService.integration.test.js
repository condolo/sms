'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongo;
let SecurityService;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: 'auth_lockout_test' });
  await mongoose.connection.collection('login_failures').createIndex(
    { key: 1 },
    { unique: true, name: 'loginfail_key_unique' },
  );
  SecurityService = require('../../services/securityService');
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('login_failures').deleteMany({});
  await mongoose.connection.collection('security_events').deleteMany({});
});

test('ten concurrent first failures produce one row with an atomic count and lock', async () => {
  await Promise.all(Array.from({ length: 10 }, () =>
    SecurityService.recordFail('sch_a', 'user@example.com', '127.0.0.1', { name: 'School A' })));

  const docs = await mongoose.connection.collection('login_failures').find({ key: 'fail:sch_a:user@example.com' }).toArray();
  expect(docs).toHaveLength(1);
  expect(docs[0].count).toBe(10);
  expect(docs[0].lockedUntil).toBeInstanceOf(Date);
  expect(new Date(docs[0].lockedUntil).getTime()).toBeGreaterThan(Date.now());
});
