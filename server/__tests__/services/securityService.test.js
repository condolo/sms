'use strict';

jest.mock('../../utils/email', () => ({
  sendSecurityAlert: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    const state = globalThis.__securityTestState;
    if (collection === 'login_failures') {
      return {
        collection: { createIndex: jest.fn().mockResolvedValue(undefined) },
        findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
        findOneAndUpdate: jest.fn((filter, pipeline, options) => {
          state.upserts.push({ filter, pipeline, options });
          return { lean: () => Promise.resolve(state.nextDoc) };
        }),
        updateOne: jest.fn((filter, update) => {
          state.lockUpdates.push({ filter, update });
          return Promise.resolve({ modifiedCount: 1 });
        }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      };
    }
    if (collection === 'security_events') {
      return {
        collection: { createIndex: jest.fn().mockResolvedValue(undefined) },
        create: jest.fn((doc) => {
          state.events.push(doc);
          return Promise.resolve(doc);
        }),
      };
    }
    return {
      find: jest.fn().mockReturnValue({
        select: () => ({ lean: () => Promise.resolve(state.admins) }),
      }),
    };
  }),
}));

describe('SecurityService.recordFail', () => {
  let SecurityService;
  let email;

  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.__securityTestState = {
      nextDoc: { id: 'fail_1', key: 'fail:sch_a:user@example.com', count: 1, lockedUntil: null },
      upserts: [],
      lockUpdates: [],
      events: [],
      admins: [{ email: 'admin@example.com', name: 'Admin' }],
    };
    jest.resetModules();
    email = require('../../utils/email');
    SecurityService = require('../../services/securityService');
  });

  test('uses one atomic upsert with a stable key', async () => {
    await SecurityService.recordFail('sch_a', 'user@example.com', '127.0.0.1');

    expect(globalThis.__securityTestState.upserts).toHaveLength(1);
    const { filter, pipeline, options } = globalThis.__securityTestState.upserts[0];
    expect(filter).toEqual({ key: 'fail:sch_a:user@example.com' });
    expect(Array.isArray(pipeline)).toBe(true);
    expect(pipeline[0].$set.count.$cond[0]).toHaveProperty('$gte', ['$windowStart', expect.any(Date)]);
    expect(options).toEqual({ returnDocument: 'after', upsert: true });
  });

  test('resets a stale window to count 1', async () => {
    await SecurityService.recordFail('sch_a', 'user@example.com', '127.0.0.1');

    const { pipeline } = globalThis.__securityTestState.upserts[0];
    const [condition, liveValue, staleValue] = pipeline[0].$set.count.$cond;
    expect(condition).toHaveProperty('$gte');
    expect(liveValue).toEqual({ $add: [{ $ifNull: ['$count', 0] }, 1] });
    expect(staleValue).toBe(1);
  });

  test('crossing the 5-failure tier writes a lockout and a LOGIN_LOCKOUT event', async () => {
    globalThis.__securityTestState.nextDoc = {
      ...globalThis.__securityTestState.nextDoc,
      count: 5,
      lockedUntil: new Date(Date.now() + 60 * 1000),
    };

    await SecurityService.recordFail('sch_a', 'user@example.com', '127.0.0.1', { name: 'School A' });

    expect(globalThis.__securityTestState.lockUpdates).toHaveLength(0);
    expect(globalThis.__securityTestState.upserts[0].pipeline[1].$set.lockedUntil.$switch.branches).toHaveLength(4);
    const event = globalThis.__securityTestState.events[0];
    expect(event.type).toBe('LOGIN_LOCKOUT');
    expect(event.lockLabel).toBe('1 minute');
    expect(event.count).toBe(5);
    expect(event.lockedUntil).not.toBeNull();
  });

  test('staying in the same tier writes LOGIN_FAILURE', async () => {
    globalThis.__securityTestState.nextDoc = {
      ...globalThis.__securityTestState.nextDoc,
      count: 6,
    };

    await SecurityService.recordFail('sch_a', 'user@example.com', '127.0.0.1');

    expect(globalThis.__securityTestState.events[0].type).toBe('LOGIN_FAILURE');
  });

  test('notifies admins at 30 failures and every 10 after that', async () => {
    globalThis.__securityTestState.nextDoc = {
      ...globalThis.__securityTestState.nextDoc,
      count: 30,
    };

    await SecurityService.recordFail('sch_a', 'user@example.com', '127.0.0.1', {
      name: 'School A',
      systemEmail: 'office@a.test',
    });

    await new Promise(resolve => setImmediate(resolve));
    expect(email.sendSecurityAlert).toHaveBeenCalledTimes(1);
    expect(email.sendSecurityAlert.mock.calls[0][0]).toMatchObject({ count: 30, schoolId: 'sch_a' });
  });
});
