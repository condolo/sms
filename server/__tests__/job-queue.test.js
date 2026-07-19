/* ============================================================
   Unit tests — server/utils/job-queue.js  (C11 Phase 1 / ADR-0006)

   First test coverage for the job queue. Reuses the exact stateful-mock
   idiom from server/__tests__/routes/mpesa-idempotency.test.js for the
   atomic-claim tests (a `claimed` boolean flag flips the mocked
   findOneAndUpdate from "matches" to "returns null", exactly as a real
   MongoDB claim would behave under a race).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../utils/model', () => ({ _model: jest.fn() }));

const { _model } = require('../utils/model');
const { enqueueJob, registerHandler, processQueueOnce } = require('../utils/job-queue');

function mockFindChain(docs) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(docs),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('enqueueJob', () => {
  test('inserts a job with the correct initial shape', async () => {
    const create = jest.fn().mockImplementation((doc) => Promise.resolve({ ...doc }));
    _model.mockReturnValue({ create });

    const id = await enqueueJob({ type: 'test_enqueue', payload: { foo: 'bar' } });

    expect(id).toMatch(/^job_/);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'test_enqueue',
      payload: { foo: 'bar' },
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
    }));
    const doc = create.mock.calls[0][0];
    expect(doc.nextAttemptAt).toBeInstanceOf(Date);
  });

  test('throws if no type is given', async () => {
    await expect(enqueueJob({ payload: {} })).rejects.toThrow(/requires a type/);
  });
});

describe('processQueueOnce — happy path', () => {
  test('claims a due job, invokes its handler with the payload, marks it completed', async () => {
    const job = { _id: 'oid_1', id: 'job_1', type: 'happy_type', payload: { x: 1 }, attempts: 0, maxAttempts: 5 };
    const find = jest.fn().mockReturnValue(mockFindChain([{ _id: 'oid_1' }]));
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ ...job, status: 'processing' }) });
    const updateOne = jest.fn().mockResolvedValue({});
    _model.mockReturnValue({ find, findOneAndUpdate, updateOne });

    const handler = jest.fn().mockResolvedValue(undefined);
    registerHandler('happy_type', handler);

    const stats = await processQueueOnce();

    expect(handler).toHaveBeenCalledWith({ x: 1 }, expect.objectContaining({ id: 'job_1' }));
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'oid_1' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'completed' }) }),
    );
    expect(stats).toEqual(expect.objectContaining({ claimed: 1, succeeded: 1 }));
  });

  test('a job with a future nextAttemptAt is never returned as a candidate (query-level exclusion)', async () => {
    const find = jest.fn().mockReturnValue(mockFindChain([])); // simulates the query correctly excluding it
    _model.mockReturnValue({ find, findOneAndUpdate: jest.fn(), updateOne: jest.fn() });

    const stats = await processQueueOnce();

    expect(stats.claimed).toBe(0);
    const filterArg = find.mock.calls[0][0];
    expect(filterArg.status).toBe('pending');
    expect(filterArg.nextAttemptAt.$lte).toBeInstanceOf(Date);
  });
});

describe('processQueueOnce — failure, backoff, dead-letter', () => {
  test('a handler throwing increments attempts, reschedules with backoff, stays pending, records lastError', async () => {
    const job = { _id: 'oid_2', id: 'job_2', type: 'fail_type', payload: {}, attempts: 0, maxAttempts: 5 };
    const find = jest.fn().mockReturnValue(mockFindChain([{ _id: 'oid_2' }]));
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ ...job, status: 'processing' }) });
    const updateOne = jest.fn().mockResolvedValue({});
    _model.mockReturnValue({ find, findOneAndUpdate, updateOne });

    registerHandler('fail_type', jest.fn().mockRejectedValue(new Error('boom')));

    const stats = await processQueueOnce();

    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'oid_2' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'pending', attempts: 1, lastError: 'boom' }),
      }),
    );
    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(stats.retried).toBe(1);
  });

  test('attempts reaching maxAttempts moves the job to dead_letter, no further reschedule', async () => {
    const job = { _id: 'oid_3', id: 'job_3', type: 'dead_type', payload: {}, attempts: 4, maxAttempts: 5 };
    const find = jest.fn().mockReturnValue(mockFindChain([{ _id: 'oid_3' }]));
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ ...job, status: 'processing' }) });
    const updateOne = jest.fn().mockResolvedValue({});
    _model.mockReturnValue({ find, findOneAndUpdate, updateOne });

    registerHandler('dead_type', jest.fn().mockRejectedValue(new Error('still broken')));

    const stats = await processQueueOnce();

    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'oid_3' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'dead_letter', attempts: 5 }) }),
    );
    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.nextAttemptAt).toBeUndefined();
    expect(stats.deadLettered).toBe(1);
  });

  test('a job with no registered handler fails gracefully into the retry path, does not throw out of processQueueOnce', async () => {
    const job = { _id: 'oid_4', id: 'job_4', type: 'unregistered_type', payload: {}, attempts: 0, maxAttempts: 5 };
    const find = jest.fn().mockReturnValue(mockFindChain([{ _id: 'oid_4' }]));
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ ...job, status: 'processing' }) });
    const updateOne = jest.fn().mockResolvedValue({});
    _model.mockReturnValue({ find, findOneAndUpdate, updateOne });

    await expect(processQueueOnce()).resolves.not.toThrow();
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'oid_4' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'pending', lastError: expect.stringMatching(/No handler registered/) }) }),
    );
  });

  test('one job failing does not stop a second candidate in the same batch from being claimed and processed', async () => {
    const jobA = { _id: 'oid_a', id: 'job_a', type: 'batch_fail', payload: {}, attempts: 0, maxAttempts: 5 };
    const jobB = { _id: 'oid_b', id: 'job_b', type: 'batch_ok',   payload: {}, attempts: 0, maxAttempts: 5 };
    const find = jest.fn().mockReturnValue(mockFindChain([{ _id: 'oid_a' }, { _id: 'oid_b' }]));
    const findOneAndUpdate = jest.fn()
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ ...jobA, status: 'processing' }) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ ...jobB, status: 'processing' }) });
    const updateOne = jest.fn().mockResolvedValue({});
    _model.mockReturnValue({ find, findOneAndUpdate, updateOne });

    registerHandler('batch_fail', jest.fn().mockRejectedValue(new Error('a fails')));
    const handlerB = jest.fn().mockResolvedValue(undefined);
    registerHandler('batch_ok', handlerB);

    const stats = await processQueueOnce();

    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(stats).toEqual(expect.objectContaining({ claimed: 2, succeeded: 1, retried: 1 }));
  });
});

describe('processQueueOnce — atomic claim', () => {
  test('two claim attempts on the same job: only the first succeeds, handler runs exactly once', async () => {
    const job = { _id: 'oid_race', id: 'job_race', type: 'race_type', payload: {}, attempts: 0, maxAttempts: 5 };
    let claimed = false;
    const find = jest.fn().mockReturnValue(mockFindChain([{ _id: 'oid_race' }]));
    const findOneAndUpdate = jest.fn(() => ({
      lean: jest.fn().mockImplementation(() => {
        if (claimed) return Promise.resolve(null);
        claimed = true;
        return Promise.resolve({ ...job, status: 'processing' });
      }),
    }));
    const updateOne = jest.fn().mockResolvedValue({});
    _model.mockReturnValue({ find, findOneAndUpdate, updateOne });

    const handler = jest.fn().mockResolvedValue(undefined);
    registerHandler('race_type', handler);

    await processQueueOnce();
    await processQueueOnce(); // simulates a second, concurrent/overlapping claim attempt on the same job

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
