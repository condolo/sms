/* ============================================================
   server/utils/workflow-config.js — unit tests
   Governance Spec §0: validate/save a school's approval chain,
   resolve a step to eligible users (vacancy + dangling-ref fallback),
   live display-name resolution for audit snapshots.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (k === '$or') return v.some(sub => matches(doc, sub));
      if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
      if (Array.isArray(doc[k])) return doc[k].includes(v);
      return doc[k] === v;
    });
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    findOneAndUpdate: (filter, update, opts = {}) => ({
      lean: async () => {
        let doc = docs.find(d => matches(d, filter));
        if (!doc) {
          if (!opts.upsert) return null;
          doc = { ...filter }; delete doc.$or; docs.push(doc);
        }
        if (update.$set) Object.assign(doc, update.$set);
        return { ...doc };
      },
    }),
    create: async (doc) => { const d = { ...doc }; docs.push(d); return d; },
  };
}

let mockStores;
jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const {
  validateSteps, getWorkflowConfig, saveWorkflowConfig, resolveStep, resolveAssigneeLabel,
} = require('../utils/workflow-config');

const SCHOOL = 'school_test_001';
const ctx = { schoolId: SCHOOL };

beforeEach(() => {
  mockStores = {
    workflow_configs: makeStore(),
    users: makeStore([
      { id: 'u_hod_1', schoolId: SCHOOL, name: 'Agnes Otieno', role: 'teacher', extraRoles: ['hod'], isActive: true },
      { id: 'u_principal', schoolId: SCHOOL, name: 'Peter Mwangi', role: 'principal', isActive: true },
      { id: 'u_deactivated_hod', schoolId: SCHOOL, name: 'Old Hod', role: 'teacher', extraRoles: ['hod'], isActive: false },
      { id: 'u_hr', schoolId: SCHOOL, name: 'Jane HR', role: 'hr', isActive: true },
    ]),
    custom_roles: makeStore([
      { schoolId: SCHOOL, key: 'director', label: 'Director' },
    ]),
  };
});

describe('validateSteps', () => {
  test('rejects fewer than minSteps', () => {
    expect(validateSteps([{ order: 1, assigneeType: 'role', assigneeValue: 'hod' }], 2)).toMatch(/At least 2/);
  });
  test('accepts exactly minSteps with valid shape', () => {
    const steps = [
      { order: 1, assigneeType: 'role', assigneeValue: 'hod' },
      { order: 2, assigneeType: 'user', assigneeValue: 'u_principal' },
    ];
    expect(validateSteps(steps, 2)).toBeNull();
  });
  test('rejects an unknown assigneeType', () => {
    expect(validateSteps([{ order: 1, assigneeType: 'bogus', assigneeValue: 'x' }], 1)).toMatch(/assigneeType/);
  });
  test('rejects a malformed fallback', () => {
    const steps = [{ order: 1, assigneeType: 'role', assigneeValue: 'hod', fallback: { assigneeType: 'role' } }];
    expect(validateSteps(steps, 1)).toMatch(/fallback/);
  });
});

describe('saveWorkflowConfig / getWorkflowConfig', () => {
  test('save rejects below the floor, does not persist', async () => {
    await expect(
      saveWorkflowConfig(ctx, SCHOOL, 'leave_approval', { steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'hod' }] }, 'u_hr', 2)
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await getWorkflowConfig(ctx, SCHOOL, 'leave_approval')).toBeNull();
  });

  test('save persists a valid chain; get returns it back', async () => {
    const steps = [
      { order: 1, assigneeType: 'role', assigneeValue: 'hod', fallback: null },
      { order: 2, assigneeType: 'user', assigneeValue: 'u_principal', fallback: null },
    ];
    const saved = await saveWorkflowConfig(ctx, SCHOOL, 'leave_approval', { steps, notifyOnly: [] }, 'u_hr', 2);
    expect(saved.steps).toHaveLength(2);
    const fetched = await getWorkflowConfig(ctx, SCHOOL, 'leave_approval');
    expect(fetched.workflowKey).toBe('leave_approval');
  });

  test('no label field is ever stored on a step', async () => {
    const steps = [
      { order: 1, assigneeType: 'role', assigneeValue: 'hod' },
      { order: 2, assigneeType: 'role', assigneeValue: 'principal' },
    ];
    const saved = await saveWorkflowConfig(ctx, SCHOOL, 'leave_approval', { steps }, 'u_hr', 2);
    for (const step of saved.steps) expect(step.label).toBeUndefined();
  });
});

describe('resolveStep', () => {
  test('resolves a role step via extraRoles (HOD is a flag, not users.role)', async () => {
    const step = { order: 1, assigneeType: 'role', assigneeValue: 'hod' };
    const result = await resolveStep(ctx, SCHOOL, step);
    expect(result.map(u => u.id)).toEqual(['u_hod_1']);
  });

  test('resolves a user step directly', async () => {
    const step = { order: 1, assigneeType: 'user', assigneeValue: 'u_principal' };
    const result = await resolveStep(ctx, SCHOOL, step);
    expect(result.map(u => u.id)).toEqual(['u_principal']);
  });

  test('a vacant role with no fallback resolves to empty', async () => {
    const step = { order: 1, assigneeType: 'role', assigneeValue: 'director', fallback: null };
    const result = await resolveStep(ctx, SCHOOL, step);
    expect(result).toEqual([]);
  });

  test('a vacant role falls back to the configured fallback', async () => {
    const step = { order: 1, assigneeType: 'role', assigneeValue: 'director', fallback: { assigneeType: 'user', assigneeValue: 'u_principal' } };
    const result = await resolveStep(ctx, SCHOOL, step);
    expect(result.map(u => u.id)).toEqual(['u_principal']);
  });

  test('a dangling user reference (deactivated) falls back, matching the vacant-role case', async () => {
    const step = { order: 1, assigneeType: 'user', assigneeValue: 'u_deactivated_hod', fallback: { assigneeType: 'user', assigneeValue: 'u_principal' } };
    const result = await resolveStep(ctx, SCHOOL, step);
    expect(result.map(u => u.id)).toEqual(['u_principal']);
  });
});

describe('resolveAssigneeLabel', () => {
  test('resolves a user id to the current live name', async () => {
    expect(await resolveAssigneeLabel(ctx, SCHOOL, 'user', 'u_principal')).toBe('Peter Mwangi');
  });
  test('resolves a custom role key to its current live label', async () => {
    expect(await resolveAssigneeLabel(ctx, SCHOOL, 'role', 'director')).toBe('Director');
  });
  test('resolves a built-in role key with no custom_roles doc by humanizing it', async () => {
    expect(await resolveAssigneeLabel(ctx, SCHOOL, 'role', 'deputy_principal')).toBe('Deputy Principal');
  });
});
