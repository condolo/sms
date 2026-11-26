'use strict';

const mockRecordFail = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/preauth-account-lookup', () => ({
  findLoginCandidates: jest.fn().mockResolvedValue([
    { id: 'usr_a', schoolId: 'sch_a', password: '$2a$10$notused' },
  ]),
  findAccountsByEmail: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/passwordHash', () => {
  class PasswordHashInfrastructureError extends Error {}
  return {
    PasswordHashInfrastructureError,
    comparePassword: jest.fn().mockRejectedValue(new PasswordHashInfrastructureError('worker busy')),
  };
});

jest.mock('../../services/securityService', () => ({
  checkAccountLock: jest.fn().mockResolvedValue(null),
  recordFail: (...args) => mockRecordFail(...args),
  clearFail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/sessionService', () => ({ createSession: jest.fn() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn(() => ({})) }));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: () => null,
  tenantModel: jest.fn(() => ({})),
}));
jest.mock('../../middleware/tenant', () => ({
  tenantMiddleware: (_req, _res, next) => next(),
  _findSchool: jest.fn(),
  _rejectExpiredDemo: jest.fn(() => false),
}));
jest.mock('../../middleware/auth', () => ({ authMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: jest.fn(),
  revokeIdentityTokens: jest.fn(),
  getIdentityTokenVersion: jest.fn(),
}));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('../../utils/csrf', () => ({ issueCsrfCookie: jest.fn(), clearCsrfCookie: jest.fn() }));
jest.mock('../../utils/school-url', () => ({ schoolLoginUrl: jest.fn() }));

const express = require('express');
const supertest = require('supertest');

test('worker infrastructure failure returns 503 and does not count as a wrong password', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../../routes/auth'));

  const res = await supertest(app).post('/api/auth/login-credentials').send({
    email: 'user@example.com',
    password: 'CorrectHorse1!',
    platform: 'mobile',
  });

  expect(res.status).toBe(503);
  expect(mockRecordFail).not.toHaveBeenCalled();
});
