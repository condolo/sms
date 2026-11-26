jest.mock('../utils/tenant-model', () => ({ platformModel: jest.fn() }));
jest.mock('../utils/job-queue', () => ({ enqueueJob: jest.fn().mockResolvedValue('job_1'), registerHandler: jest.fn(), registerRecoveryHook: jest.fn() }));
jest.mock('../services/audit', () => ({ log: jest.fn() }));
jest.mock('../utils/email', () => ({
  outreachReady: jest.fn(() => true),
  sendOutreach: jest.fn().mockResolvedValue(true),
}));

const { platformModel } = require('../utils/tenant-model');
const { enqueueJob } = require('../utils/job-queue');
const email = require('../utils/email');
const outreach = require('../services/outreachService');

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, PLATFORM_JWT_SECRET: 'test-platform-secret', OUTREACH_ENABLED: 'true', OUTREACH_REPLY_TO: 'sales@example.test' };
  email.outreachReady.mockReturnValue(true);
  email.sendOutreach.mockResolvedValue(true);
});

afterAll(() => { process.env = ORIGINAL_ENV; });

describe('CSV import parsing', () => {
  test('handles quoted commas, escaped quotes and newlines', () => {
    const rows = outreach.parseCsv('school_name,email,notes\r\n"Kivuli, Academy",office@example.test,"He said ""hello""\nThen left"\r\n');
    expect(rows).toEqual([
      ['school_name', 'email', 'notes'],
      ['Kivuli, Academy', 'office@example.test', 'He said "hello"\nThen left'],
    ]);
  });

  test('rejects unclosed quoted fields', () => {
    expect(() => outreach.parseCsv('school_name,email\n"Kivuli,office@example.test')).toThrow(/unclosed quoted field/);
  });

  test('imports valid rows while reporting invalid and duplicate emails', async () => {
    const leads = {
      bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
      updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
    };
    const suppressions = {
      find: jest.fn(() => ({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) })),
    };
    platformModel.mockImplementation(name => name === 'outreach_leads' ? leads : suppressions);
    const result = await outreach.importLeads({
      csv: 'school_name,email\nKivuli Academy,office@example.test\nKivuli Academy,OFFICE@example.test\nBad School,not-an-email',
      actor: { userId: 'op_1', name: 'Operator' },
    });
    expect(result).toEqual(expect.objectContaining({ created: 1, updated: 0, skipped: 1, suppressed: 0, errorCount: 1 }));
    expect(leads.bulkWrite).toHaveBeenCalledTimes(1);
  });
});

describe('send scheduling', () => {
  test('spreads a daily batch across business hours and skips weekends', () => {
    const saturday = new Date('2026-11-28T06:00:00.000Z'); // Saturday
    const first = outreach.scheduledSlot(saturday, 0, 0, 25);
    const last = outreach.scheduledSlot(saturday, 0, 24, 25);
    expect(first.getUTCDay()).not.toBe(0);
    expect(first.getUTCDay()).not.toBe(6);
    expect(first.getUTCHours()).toBeGreaterThanOrEqual(5); // 08:00 Nairobi
    expect(last.getTime()).toBeGreaterThan(first.getTime());
  });

  test('honours a same-day launch time and rolls after-hours launches to the next business day', () => {
    const morning = outreach.scheduledSlot(new Date('2026-11-25T09:30:00.000Z'), 0, 0, 25); // 12:30 Nairobi
    expect(morning.getUTCHours()).toBeGreaterThanOrEqual(9);
    const evening = outreach.scheduledSlot(new Date('2026-11-25T15:00:00.000Z'), 0, 0, 25); // 18:00 Nairobi
    expect(evening.toISOString().slice(0, 10)).toBe('2026-11-26');
    expect(evening.getUTCHours()).toBe(5);
  });
});

describe('unsubscribe tokens', () => {
  test('round-trips a send id and rejects tampering', () => {
    const token = outreach.createUnsubscribeToken('send_1');
    expect(outreach.verifyUnsubscribeToken(token)).toEqual(expect.objectContaining({ sendId: 'send_1' }));
    expect(outreach.verifyUnsubscribeToken(token + 'x')).toBeNull();
    expect(outreach.verifyUnsubscribeToken('bad.token')).toBeNull();
  });
});

function setupSend({ suppressed = false, sentToday = 0, campaignStatus = 'running', leadStatus = 'new' } = {}) {
  const send = { id: 'send_1', campaignId: 'camp_1', leadId: 'lead_1', email: 'office@example.test', schoolName: 'Kivuli Academy', stepIndex: 0, status: 'queued' };
  const campaign = {
    id: 'camp_1', status: campaignStatus, dailyLimit: 25,
    steps: [outreach.DEFAULT_TEMPLATES[0]],
  };
  const lead = { id: 'lead_1', email: send.email, schoolName: send.schoolName, status: leadStatus, curriculum: 'CBC' };
  let findCount = 0;
  const sends = {
    findOne: jest.fn(() => {
      findCount += 1;
      const status = findCount === 1 ? 'queued' : 'sending';
      return { lean: jest.fn().mockResolvedValue({ ...send, status }) };
    }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: jest.fn().mockImplementation(async filter => filter.status === 'sent' ? sentToday : 0),
  };
  const collections = {
    outreach_sends: sends,
    outreach_campaigns: { findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(campaign) })), updateOne: jest.fn().mockResolvedValue({}) },
    outreach_leads: { findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(lead) })), updateOne: jest.fn().mockResolvedValue({}) },
    outreach_suppressions: { exists: jest.fn().mockResolvedValue(suppressed) },
    outreach_reservations: { exists: jest.fn().mockResolvedValue(null), countDocuments: jest.fn().mockResolvedValue(0), deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) },
    queue_jobs: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) },
  };
  platformModel.mockImplementation(name => collections[name]);
  return { send, campaign, lead, sends, collections };
}

describe('outreach send worker safeguards', () => {
  test('sends once, records the outcome and advances a new lead to contacted', async () => {
    const { sends, collections } = setupSend();
    await outreach.processOutreachSend('send_1');

    expect(email.sendOutreach).toHaveBeenCalledWith(expect.objectContaining({
      to: 'office@example.test', fromName: 'Msingi Schools Team', replyTo: 'sales@example.test',
      headers: expect.objectContaining({ 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }),
    }));
    expect(sends.updateOne).toHaveBeenCalledWith({ id: 'send_1' }, expect.objectContaining({ $set: expect.objectContaining({ status: 'sent' }) }));
    expect(collections.outreach_leads.updateOne).toHaveBeenCalledWith(
      { id: 'lead_1', status: 'new' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'contacted' }) }),
    );
    expect(collections.outreach_campaigns.updateOne).toHaveBeenCalledWith({ id: 'camp_1', status: { $in: ['running', 'paused'] } }, expect.objectContaining({ $set: expect.objectContaining({ status: 'completed' }) }));
  });

  test('a suppressed address is skipped without sending', async () => {
    const { sends } = setupSend({ suppressed: true });
    await outreach.processOutreachSend('send_1');
    expect(email.sendOutreach).not.toHaveBeenCalled();
    expect(sends.updateOne).toHaveBeenCalledWith({ id: 'send_1' }, expect.objectContaining({ $set: expect.objectContaining({ status: 'skipped', skipReason: 'suppressed' }) }));
  });

  test('a replied lead stops the sequence without sending', async () => {
    const { sends } = setupSend({ leadStatus: 'replied' });
    await outreach.processOutreachSend('send_1');
    expect(email.sendOutreach).not.toHaveBeenCalled();
    expect(sends.updateOne).toHaveBeenCalledWith({ id: 'send_1' }, expect.objectContaining({ $set: expect.objectContaining({ skipReason: 'lead_replied' }) }));
  });

  test('the daily cap requeues the send for the next business day', async () => {
    const { sends } = setupSend({ sentToday: 25 });
    await outreach.processOutreachSend('send_1');
    expect(email.sendOutreach).not.toHaveBeenCalled();
    expect(sends.updateOne).toHaveBeenCalledWith({ id: 'send_1' }, expect.objectContaining({ $set: expect.objectContaining({ status: 'queued' }) }));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'outreach_send', payload: { sendId: 'send_1' } }));
  });

  test('a paused campaign leaves the recipient queued for resume', async () => {
    const { sends } = setupSend({ campaignStatus: 'paused' });
    await outreach.processOutreachSend('send_1');
    expect(email.sendOutreach).not.toHaveBeenCalled();
    expect(sends.updateOne).toHaveBeenCalledWith({ id: 'send_1' }, expect.objectContaining({ $set: expect.objectContaining({ status: 'queued' }) }));
  });

  test('post-SMTP bookkeeping failure never downgrades a sent email to retryable failed', async () => {
    const { sends, collections } = setupSend();
    collections.outreach_leads.updateOne.mockRejectedValue(new Error('database unavailable'));
    await outreach.processOutreachSend('send_1');
    expect(email.sendOutreach).toHaveBeenCalledTimes(1);
    expect(sends.updateOne).toHaveBeenCalledWith({ id: 'send_1' }, expect.objectContaining({ $set: expect.objectContaining({ status: 'sent' }) }));
    expect(sends.updateOne).not.toHaveBeenCalledWith({ id: 'send_1' }, expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }));
  });

  test('active campaigns keep recipient reservations after a send', async () => {
    const { collections } = setupSend();
    await outreach.processOutreachSend('send_1');
    expect(collections.outreach_reservations.deleteMany).not.toHaveBeenCalled();
  });

  test('cancelled campaigns release reservations after an early worker exit', async () => {
    const { collections } = setupSend({ campaignStatus: 'cancelled' });
    await outreach.processOutreachSend('send_1');
    expect(collections.outreach_reservations.deleteMany).toHaveBeenCalledWith({ campaignId: 'camp_1' });
  });
});
