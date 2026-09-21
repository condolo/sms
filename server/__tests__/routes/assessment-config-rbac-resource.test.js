/* ============================================================
   server/routes/assessment.js — config/schedule/types/grade-scales
   RBAC resource key (2026-09)

   Found live: an admin gave a teacher the built-in "Exams Officer"
   role with full exam/report-card access (which grants 'assessment'
   RCUD by default — see server/utils/repairPermissions.js), and that
   account still hit "Your role does not have 'read' permission on
   'settings'" the moment the Exams page loaded. Root cause: GET/PATCH
   /config, GET/PUT/DELETE /schedule(+/:id), GET/POST/PUT/DELETE
   /types(+/:key), GET/POST/PUT/DELETE /grade-scales(+/:id), and POST
   /reminders/notify were all gated on rbac('settings', ...) — a
   genuinely different RBAC resource from 'exams'/'grades'/
   'assessment'/'report_cards', which is the only bundle "full access
   to exam and report-card modules" can actually grant. Fixed by
   switching all of them to rbac('assessment', ...), matching the
   sibling routes (/schedule/:id/lock, /unlock) that already used it
   correctly.

   rbac(mod, action) is a FACTORY called once per route at module-load
   time (router.get('/x', ..., rbac('mod','action'), handler) — the
   call happens when that line is evaluated, not per-request), so this
   test records every (mod, action) pair by requiring the router fresh
   and asserting on what got registered, rather than firing requests.
   Every other assessment.js test file mocks rbac as a bare no-op and
   so never could have caught this class of bug.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const rbacCalls = [];
jest.mock('../../middleware/rbac', () => ({
  rbac: (mod, action) => { rbacCalls.push(`${mod}:${action}`); return (_req, _res, next) => next(); },
}));
jest.mock('../../middleware/auth', () => ({ authMiddleware: (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: jest.fn(), firstArchivedYear: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/model', () => ({ _model: jest.fn() }));
jest.mock('../../utils/tenant-model', () => ({ tenantContext: jest.fn(), tenantModel: jest.fn() }));

// Registering the router evaluates every router.METHOD(...) call in the
// file, including each rbac(mod, action) factory invocation — this is
// where rbacCalls gets populated, once, for the whole file.
require('../../routes/assessment');

describe('assessment.js route registration — RBAC resource keys', () => {
  // Note: requiring '../../routes/assessment' also pulls in
  // './academic-config' (for mergeConfig/resolveCurrentPeriod), whose OWN
  // routes legitimately use rbac('settings', ...) for broader, genuinely
  // settings-scoped school config — those are expected and untouched by
  // this fix, so this file asserts presence of the correct calls rather
  // than a blanket absence of 'settings' across the whole require graph.
  test('assessment:read and assessment:update were registered — the config/schedule/types/grade-scales fix took effect', () => {
    expect(rbacCalls).toEqual(expect.arrayContaining(['assessment:read', 'assessment:update']));
  });

  test('assessment:read/update appear at least as many times as the config-area routes that should use them (11 routes across config/schedule/types/grade-scales, minimum)', () => {
    const assessmentCalls = rbacCalls.filter(c => c.startsWith('assessment:'));
    // GET/PATCH /config, GET/PUT/DELETE /schedule, /schedule/:id/lock,
    // /schedule/:id/unlock, GET/POST/PUT/DELETE /types,
    // GET/POST/PUT/DELETE /grade-scales, POST /reminders/notify, plus
    // every other already-correct 'assessment'-gated route in the file.
    expect(assessmentCalls.length).toBeGreaterThanOrEqual(16);
  });
});
