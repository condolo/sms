/* ============================================================
   Unit tests — server/services/audit.js

   First-ever direct test coverage for AuditService. Written for C5
   (MR-002): pins the additive enrichment contract — every entry gets
   `correlationId` from req.correlationId, and `orgId`/`membershipId`
   derived from a {userId,schoolId} membership lookup, skipped
   entirely (no lookup) when there's no schoolId/actor to look up
   against, and never allowed to block the write if the lookup fails.
   ============================================================ */

let mockCreate;
let mockFind;
let mockCountDocuments;
let mockMembershipFindOne;
let mockMembershipDoc;

jest.mock('../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'audit_logs') {
      return {
        create: mockCreate,
        find: mockFind,
        countDocuments: mockCountDocuments,
      };
    }
    if (collection === 'memberships') {
      return { findOne: mockMembershipFindOne };
    }
    throw new Error(`Unexpected collection: ${collection}`);
  }),
}));

const AuditService = require('../services/audit');

beforeEach(() => {
  jest.clearAllMocks();
  mockMembershipDoc = null;
  mockCreate = jest.fn().mockResolvedValue({ _id: 'mock_doc' });
  mockFind = jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  });
  mockCountDocuments = jest.fn().mockResolvedValue(0);
  mockMembershipFindOne = jest.fn().mockReturnValue({
    lean: jest.fn().mockImplementation(() => Promise.resolve(mockMembershipDoc)),
  });
});

describe('AuditService.log — correlation ID', () => {
  test('writes correlationId from req.correlationId', async () => {
    await AuditService.log({
      action: 'auth.login',
      actor: { userId: 'usr_1', role: 'admin', email: 'a@x.com' },
      schoolId: 'sch_1',
      req: { correlationId: 'corr_abc123' },
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'corr_abc123' })
    );
  });

  test('writes null correlationId when req is absent', async () => {
    await AuditService.log({
      action: 'auth.login',
      actor: { userId: 'usr_1', role: 'admin' },
      schoolId: 'sch_1',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: null })
    );
  });
});

describe('AuditService.log — membership/org enrichment', () => {
  test('enriches orgId/membershipId when a matching membership exists', async () => {
    mockMembershipDoc = { id: 'mem_1', orgId: 'org_1' };

    await AuditService.log({
      action: 'auth.login',
      actor: { userId: 'usr_1', role: 'admin' },
      schoolId: 'sch_1',
    });

    expect(mockMembershipFindOne).toHaveBeenCalledWith({ userId: 'usr_1', schoolId: 'sch_1' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', membershipId: 'mem_1' })
    );
  });

  test('orgId/membershipId stay null when no membership doc exists', async () => {
    mockMembershipDoc = null;

    await AuditService.log({
      action: 'auth.login',
      actor: { userId: 'usr_1', role: 'admin' },
      schoolId: 'sch_1',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: null, membershipId: null })
    );
  });

  test('platform-operator actor (literal "platform" userId, no real membership): looks up but degrades to null, never errors', async () => {
    await AuditService.log({
      action: 'platform.school_deleted',
      actor: { userId: 'platform', role: 'platform', email: null },
      schoolId: 'sch_1',
    });

    // 'platform' IS a non-empty userId string, so a lookup legitimately
    // happens (it just never matches a real membership doc) — confirm
    // it looks up with exactly that value and degrades safely.
    expect(mockMembershipFindOne).toHaveBeenCalledWith({ userId: 'platform', schoolId: 'sch_1' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: null, membershipId: null })
    );
  });

  test('skips the membership lookup entirely when actor has no userId/id field at all', async () => {
    await AuditService.log({
      action: 'auth.login',
      actor: { role: 'admin', email: 'a@x.com' },
      schoolId: 'sch_1',
    });

    expect(mockMembershipFindOne).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: null, membershipId: null })
    );
  });

  test('skips the membership lookup entirely when schoolId is absent', async () => {
    await AuditService.log({
      action: 'auth.login',
      actor: { userId: 'usr_1', role: 'admin' },
      schoolId: null,
    });

    expect(mockMembershipFindOne).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: null, membershipId: null })
    );
  });

  test('skips the membership lookup entirely when actor is absent altogether', async () => {
    await AuditService.log({
      action: 'auth.login',
      schoolId: 'sch_1',
    });

    expect(mockMembershipFindOne).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: null, membershipId: null })
    );
  });

  test('a membership-lookup failure does not block the audit write', async () => {
    mockMembershipFindOne.mockReturnValue({
      lean: jest.fn().mockRejectedValue(new Error('transient DB error')),
    });

    await expect(AuditService.log({
      action: 'auth.login',
      actor: { userId: 'usr_1', role: 'admin' },
      schoolId: 'sch_1',
    })).resolves.not.toThrow();

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: null, membershipId: null })
    );
  });
});

describe('AuditService.query — new filters', () => {
  test('applies correlationId/orgId/membershipId to the Mongo filter when provided', async () => {
    await AuditService.query({ correlationId: 'corr_1', orgId: 'org_1', membershipId: 'mem_1' });

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'corr_1', orgId: 'org_1', membershipId: 'mem_1' })
    );
  });

  test('omits correlationId/orgId/membershipId from the filter when not provided', async () => {
    await AuditService.query({ schoolId: 'sch_1' });

    const filterArg = mockFind.mock.calls[0][0];
    expect(filterArg).not.toHaveProperty('correlationId');
    expect(filterArg).not.toHaveProperty('orgId');
    expect(filterArg).not.toHaveProperty('membershipId');
  });
});
