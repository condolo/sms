/* ============================================================
   DELETE /api/classes/:id — bell schedule cleanup

   Two things must stay true when a class is deleted:
     1. (existing) The class is pulled out of any bell schedule's
        classIds — it can't keep holding a slot in a one-schedule-per-
        class world once it no longer exists.
     2. (new) If that pull is what empties a genuine CLASS schedule
        (isDefault: false) down to zero classes, the now-empty document
        itself is deleted — not left behind as a zombie. A document with
        classIds: [] matches the exact same "default" query every real
        section/school default does (resolveBellSchedule's
        SECTION_DEFAULT), so leaving it around would make it start
        competing, non-deterministically, with the school's actual
        default. A genuine default (isDefault: true, or no isDefault
        field at all — pre-dating that field) is never touched by this.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next(), invalidateModuleConfigCache: jest.fn() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next() }));

function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    const val = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return Array.isArray(val) ? val.some(x => v.$in.includes(x)) : v.$in.includes(val);
      if ('$size' in v) return Array.isArray(val) && val.length === v.$size;
      if ('$ne' in v) return val !== v.$ne;
    }
    return val === v;
  });
}

let mockClassDocs, mockStreamDocs, mockBellDocs;

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: jest.fn((col) => {
    if (col === 'classes') {
      return {
        findOneAndUpdate: (filter, update) => ({
          lean: async () => {
            const doc = mockClassDocs.find(d => mockMatchesFilter(d, filter));
            if (!doc) return null;
            Object.assign(doc, update);
            return { ...doc };
          },
        }),
      };
    }
    if (col === 'streams') {
      return { countDocuments: async (filter) => mockStreamDocs.filter(d => mockMatchesFilter(d, filter)).length };
    }
    if (col === 'bell_schedules') {
      return {
        updateMany: async (filter, update) => {
          let n = 0;
          for (const d of mockBellDocs) {
            if (mockMatchesFilter(d, filter)) {
              if (update.$pull?.classIds) {
                const pull = update.$pull.classIds.$in;
                d.classIds = (d.classIds ?? []).filter(id => !pull.includes(id));
              }
              n++;
            }
          }
          return { modifiedCount: n };
        },
        deleteMany: async (filter) => {
          const before = mockBellDocs.length;
          mockBellDocs = mockBellDocs.filter(d => !mockMatchesFilter(d, filter));
          return { deletedCount: before - mockBellDocs.length };
        },
      };
    }
    return { find: async () => [], findOne: async () => null };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const classesRouter = require('../../routes/classes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/classes', classesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStreamDocs = [];
  mockClassDocs = [{ id: 'cls_a', schoolId: SCHOOL, name: 'Form 1A', status: 'active' }];
});

describe('DELETE /api/classes/:id — bell schedule cleanup', () => {
  test('the class is pulled out of a schedule it shares with another class — the schedule survives', async () => {
    mockBellDocs = [
      { id: 'bs_1', schoolId: SCHOOL, section: 'all', name: 'Shared', classIds: ['cls_a', 'cls_b'], isDefault: false },
    ];
    const res = await supertest(buildApp()).delete('/api/classes/cls_a');
    expect(res.status).toBe(200);
    expect(mockBellDocs).toHaveLength(1);
    expect(mockBellDocs[0].classIds).toEqual(['cls_b']);
  });

  test('a class schedule emptied by this delete (isDefault: false) is removed entirely — not left as a zombie default', async () => {
    mockBellDocs = [
      { id: 'bs_1', schoolId: SCHOOL, section: 'all', name: 'Form 1A only', classIds: ['cls_a'], isDefault: false },
    ];
    const res = await supertest(buildApp()).delete('/api/classes/cls_a');
    expect(res.status).toBe(200);
    expect(mockBellDocs).toHaveLength(0);
  });

  test('a genuine default (isDefault: true, already empty) is never touched', async () => {
    mockBellDocs = [
      { id: 'bs_school', schoolId: SCHOOL, section: 'all', name: 'School default', classIds: [], isDefault: true },
    ];
    const res = await supertest(buildApp()).delete('/api/classes/cls_a');
    expect(res.status).toBe(200);
    expect(mockBellDocs).toHaveLength(1);
  });

  test('a legacy default with no isDefault field at all (pre-dating classIds) is never touched', async () => {
    mockBellDocs = [
      { id: 'bs_legacy', schoolId: SCHOOL, section: 'primary', name: 'Primary default', classIds: [] },
    ];
    const res = await supertest(buildApp()).delete('/api/classes/cls_a');
    expect(res.status).toBe(200);
    expect(mockBellDocs).toHaveLength(1);
  });
});
