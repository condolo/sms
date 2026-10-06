/* ============================================================
   Where a school's users sign in (utils/school-url.js).

   A school in an organisation links to the organisation's portal. A
   school on its own links to its own address. The marketing site is
   only the last resort.
   ============================================================ */
'use strict';

let mockSchool;
let mockOrg;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    const chain = (r) => ({ select: () => chain(r), lean: () => Promise.resolve(r) });
    if (col === 'schools') return { findOne: () => chain(global.__mockSchool) };
    if (col === 'organizations') return { findOne: () => chain(global.__mockOrg) };
    return { findOne: () => chain(null) };
  }),
}));

const { schoolLoginUrl } = require('../../utils/school-url');

beforeEach(() => {
  global.__mockSchool = { id: 'sch_1', slug: 'trinitas', organizationId: null };
  global.__mockOrg = null;
});

describe('schoolLoginUrl', () => {
  test('a school on its own links to its own address', async () => {
    expect(await schoolLoginUrl('sch_1')).toBe('https://trinitas.msingi.io');
  });

  test('a school in an organisation links to the organisation\'s portal', async () => {
    global.__mockSchool = { id: 'sch_1', slug: 'trinitas', organizationId: 'org_1' };
    global.__mockOrg = { id: 'org_1', slug: 'tis' };
    expect(await schoolLoginUrl('sch_1')).toBe('https://tis.msingi.io');
  });

  test('a school with no slug falls back to the marketing address rather than an empty host', async () => {
    global.__mockSchool = { id: 'sch_1', slug: '', organizationId: null };
    expect(await schoolLoginUrl('sch_1')).toMatch(/^https:\/\//);
    expect(await schoolLoginUrl('sch_1')).not.toMatch(/undefined|\.msingi\.io$/);
  });
});
