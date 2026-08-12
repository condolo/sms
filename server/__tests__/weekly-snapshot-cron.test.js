/* ============================================================
   server/utils/weekly-snapshot-cron.js — maybeGenerateForSchool()

   Covers: the Saturday-13:00-local delivery gate evaluated independently
   per school timezone (not a single global cut-off), Monday..Sunday
   week-boundary derivation, and idempotency — a second call for a week
   that's already (fully) generated must write nothing, which IS this
   feature's catch-up mechanism (see the module's own header comment).

   The aggregation step itself (buildSnapshotsForSchool) is mocked here —
   its own correctness is covered by weekly-snapshot-aggregate.test.js.
   This file is only about the cron's gating/idempotency logic.
   ============================================================ */
'use strict';

function mockChain(result) {
  return { select: () => mockChain(result), lean: () => Promise.resolve(result) };
}
function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => doc[k] === v);
}
function mockApplySet(doc, setObj) {
  for (const [path, val] of Object.entries(setObj || {})) {
    const parts = path.split('.');
    let obj = doc;
    for (let i = 0; i < parts.length - 1; i++) {
      obj[parts[i]] = obj[parts[i]] || {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = val;
  }
}

let mockSchools;
let mockSnapshots; // mutated in place by create()/updateOne()

jest.mock('../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'schools') {
      return { find: (filter) => mockChain(mockSchools.filter(d => mockMatches(d, filter))) };
    }
    if (col === 'weekly_snapshots') {
      return {
        find: jest.fn((filter) => mockChain(mockSnapshots.filter(d => mockMatches(d, filter)))),
        create: jest.fn((doc) => { mockSnapshots.push(doc); return Promise.resolve(doc); }),
        updateOne: jest.fn((filter, update) => {
          const doc = mockSnapshots.find(d => mockMatches(d, filter));
          if (doc && update?.$set) mockApplySet(doc, update.$set);
          return Promise.resolve({ acknowledged: true });
        }),
      };
    }
    throw new Error(`unexpected _model('${col}') call`);
  }),
}));

const mockFetchActiveRoster = jest.fn();
const mockBuildSnapshots = jest.fn();
jest.mock('../utils/weekly-snapshot-aggregate', () => ({
  fetchActiveRoster: (...args) => mockFetchActiveRoster(...args),
  buildSnapshotsForSchool: (...args) => mockBuildSnapshots(...args),
}));

const mockNotifyGuardiansForStudents = jest.fn();
jest.mock('../utils/notify-students', () => ({
  notifyGuardiansForStudents: (...args) => mockNotifyGuardiansForStudents(...args),
}));
jest.mock('../utils/email', () => ({ sendWeeklySnapshotReady: jest.fn() }));

const { maybeGenerateForSchool } = require('../utils/weekly-snapshot-cron');

const SCHOOL_A = 'school_a'; // Africa/Nairobi (UTC+3)
const ROSTER = [
  { id: 'stu_1', classId: 'cls_1', className: '5A' },
  { id: 'stu_2', classId: 'cls_1', className: '5A' },
];

function emptySections() {
  return { topics: [], assignments: [], attendance: { present: 0, absent: 0, late: 0, authorisedAbsence: 0, excluded: 0, holiday: 0, total: 0, records: [] }, behaviour: [], medical: [], library: [], growth: [] };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockSchools = [];
  mockSnapshots = [];
  mockFetchActiveRoster.mockResolvedValue(ROSTER);
  mockBuildSnapshots.mockImplementation(async (_ctx, _ws, _we, _tz, roster) => {
    const m = new Map();
    for (const s of roster) m.set(s.id, emptySections());
    return m;
  });
  mockNotifyGuardiansForStudents.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('per-school-timezone delivery gate', () => {
  test('Saturday 13:05 local (Africa/Nairobi, UTC+3) is inside the window — generates', async () => {
    jest.setSystemTime(new Date('2026-08-08T10:05:00.000Z')); // Sat, Nairobi local 13:05
    const school = { id: SCHOOL_A, timezone: 'Africa/Nairobi' };
    const result = await maybeGenerateForSchool(school);
    expect(result.generated).toBe(2);
    expect(result.weekStart).toBe('2026-08-03'); // Monday of that week
    expect(result.weekEnd).toBe('2026-08-09');   // Sunday
  });

  test('Saturday 12:00 local (Africa/Nairobi) is before the 13:00 cut-off — skips', async () => {
    jest.setSystemTime(new Date('2026-08-08T09:00:00.000Z')); // Sat, Nairobi local 12:00
    const school = { id: SCHOOL_A, timezone: 'Africa/Nairobi' };
    const result = await maybeGenerateForSchool(school);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe('not-yet-window');
    expect(mockBuildSnapshots).not.toHaveBeenCalled();
  });

  test('a non-Saturday at the same local hour skips regardless of time', async () => {
    jest.setSystemTime(new Date('2026-08-05T10:05:00.000Z')); // Wed, Nairobi local 13:05
    const school = { id: SCHOOL_A, timezone: 'Africa/Nairobi' };
    const result = await maybeGenerateForSchool(school);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe('not-yet-window');
  });

  test('two schools in different timezones are gated independently at the identical UTC instant', async () => {
    // 2026-08-08T10:05:00Z: Africa/Nairobi (UTC+3) reads Sat 13:05 — inside
    // the window; America/Los_Angeles (UTC-7, PDT) reads Sat 03:05 — well
    // before its own 13:00 cut-off.
    jest.setSystemTime(new Date('2026-08-08T10:05:00.000Z'));
    const nairobi = await maybeGenerateForSchool({ id: 'sch_nairobi', timezone: 'Africa/Nairobi' });
    const losAngeles = await maybeGenerateForSchool({ id: 'sch_la', timezone: 'America/Los_Angeles' });
    expect(nairobi.generated).toBe(2);
    expect(losAngeles.generated).toBe(0);
    expect(losAngeles.skipped).toBe('not-yet-window');
  });

  test('a school with no timezone set falls back to Africa/Nairobi (matches settings.js default)', async () => {
    jest.setSystemTime(new Date('2026-08-08T10:05:00.000Z'));
    const result = await maybeGenerateForSchool({ id: 'sch_no_tz' });
    expect(result.generated).toBe(2);
  });
});

describe('idempotency (the catch-up mechanism)', () => {
  test('a second call for an already-fully-generated week writes nothing', async () => {
    jest.setSystemTime(new Date('2026-08-08T10:05:00.000Z'));
    const school = { id: SCHOOL_A, timezone: 'Africa/Nairobi' };

    const first = await maybeGenerateForSchool(school);
    expect(first.generated).toBe(2);
    expect(mockSnapshots).toHaveLength(2);

    const second = await maybeGenerateForSchool(school);
    expect(second.generated).toBe(0);
    expect(second.skipped).toBe('already-generated');
    expect(mockSnapshots).toHaveLength(2); // unchanged — no duplicate writes
  });

  test('a partially-generated week (e.g. crash mid-batch) only fills in the missing students', async () => {
    jest.setSystemTime(new Date('2026-08-08T10:05:00.000Z'));
    const school = { id: SCHOOL_A, timezone: 'Africa/Nairobi' };
    // Pre-seed as if stu_1 was already generated by an earlier tick.
    mockSnapshots.push({ id: 'existing_1', schoolId: SCHOOL_A, studentId: 'stu_1', weekStart: '2026-08-03' });

    const result = await maybeGenerateForSchool(school);
    expect(result.generated).toBe(1); // only stu_2
    expect(mockBuildSnapshots).toHaveBeenCalledWith(
      expect.any(Object), '2026-08-03', '2026-08-09', 'Africa/Nairobi',
      expect.arrayContaining([expect.objectContaining({ id: 'stu_2' })]),
    );
    expect(mockSnapshots).toHaveLength(2);
  });

  test('a school with no active students is skipped without touching weekly_snapshots', async () => {
    jest.setSystemTime(new Date('2026-08-08T10:05:00.000Z'));
    mockFetchActiveRoster.mockResolvedValue([]);
    const result = await maybeGenerateForSchool({ id: SCHOOL_A, timezone: 'Africa/Nairobi' });
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe('no-active-students');
    expect(mockSnapshots).toHaveLength(0);
  });
});

describe('written document shape', () => {
  test('generated snapshots carry the frozen classId/className, schoolTimezone, and stamped notified block', async () => {
    jest.setSystemTime(new Date('2026-08-08T10:05:00.000Z'));
    await maybeGenerateForSchool({ id: SCHOOL_A, timezone: 'Africa/Nairobi' });

    const doc = mockSnapshots.find(d => d.studentId === 'stu_1');
    expect(doc).toMatchObject({
      schoolId: SCHOOL_A, studentId: 'stu_1', classId: 'cls_1', className: '5A',
      weekStart: '2026-08-03', weekEnd: '2026-08-09', schoolTimezone: 'Africa/Nairobi',
    });
    expect(typeof doc.id).toBe('string');
    expect(typeof doc.generatedAt).toBe('string');
    expect(doc.sections).toBeDefined();
    // notified.* was null at write time, then stamped by the post-generation
    // notification step (see 'parent notification dispatch' below) —
    // by the time maybeGenerateForSchool() resolves, dispatch already ran.
    expect(doc.notified.emailError).toBeNull();
    expect(typeof doc.notified.emailSentAt).toBe('string');
    expect(typeof doc.notified.inAppSentAt).toBe('string');
  });
});

describe('parent notification dispatch (M4)', () => {
  test('notifyGuardiansForStudents is called once with the weekly_snapshot_ready event key, one item per generated student', async () => {
    jest.setSystemTime(new Date('2026-08-08T10:05:00.000Z'));
    const school = { id: SCHOOL_A, timezone: 'Africa/Nairobi', name: 'Test School', systemEmail: 'admin@test.io' };
    await maybeGenerateForSchool(school);

    expect(mockNotifyGuardiansForStudents).toHaveBeenCalledTimes(1);
    const call = mockNotifyGuardiansForStudents.mock.calls[0][0];
    expect(call.eventKey).toBe('weekly_snapshot_ready');
    expect(call.schoolId).toBe(SCHOOL_A);
    expect(call.items).toHaveLength(2);
    expect(call.items.map(i => i.studentId).sort()).toEqual(['stu_1', 'stu_2']);
    expect(typeof call.items[0].sendEmail).toBe('function');
  });

  test('a notification dispatch failure does not change the already-committed generation result', async () => {
    jest.setSystemTime(new Date('2026-08-08T10:05:00.000Z'));
    mockNotifyGuardiansForStudents.mockRejectedValueOnce(new Error('smtp down'));
    const result = await maybeGenerateForSchool({ id: SCHOOL_A, timezone: 'Africa/Nairobi' });
    expect(result.generated).toBe(2); // snapshots were already written before notify ran
    expect(mockSnapshots).toHaveLength(2);
  });

  test('no notification attempt when nothing new was generated (already-generated week)', async () => {
    jest.setSystemTime(new Date('2026-08-08T10:05:00.000Z'));
    const school = { id: SCHOOL_A, timezone: 'Africa/Nairobi' };
    await maybeGenerateForSchool(school);
    mockNotifyGuardiansForStudents.mockClear();

    await maybeGenerateForSchool(school); // fully generated already — no-op
    expect(mockNotifyGuardiansForStudents).not.toHaveBeenCalled();
  });
});
