/* Unit tests for the demo tenant helpers — pure functions, no DB. */
'use strict';

const demo = require('../utils/demo');

describe('demo helpers', () => {
  test('trial length defaults to 7 days (DEMO_TRIAL_DAYS override respected)', () => {
    expect(demo.TRIAL_DAYS).toBe(7);
  });

  test('generated passwords are 14 chars from the unambiguous alphabet', () => {
    const pwd = demo.generatePassword();
    expect(pwd).toHaveLength(14);
    expect(pwd).toMatch(/^[A-HJ-NP-Za-km-z2-9!@#$%]+$/);
  });

  test('passwords are random (no repeats across draws)', () => {
    const set = new Set(Array.from({ length: 50 }, () => demo.generatePassword()));
    expect(set.size).toBe(50);
  });

  test('demo slugs are prefixed, readable and unique', () => {
    const a = demo.makeDemoSlug('Riverside Academy');
    const b = demo.makeDemoSlug('Riverside Academy');
    expect(a).toMatch(/^demo-riverside-academy-[a-f0-9]{4}$/);
    expect(a).not.toBe(b);
  });

  test('slugify strips punctuation and spaces', () => {
    expect(demo.slugifySchool("St. Mary's School!!")).toBe('st-marys-school');
    expect(demo.slugifySchool('')).toBe('school');
  });

  test('addDays returns a new date, not a mutated one', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = demo.addDays(start, 7);
    expect(end.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  test('isExpired only applies to demo tenants', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(demo.isExpired({ isDemo: true, expiresAt: past })).toBe(true);
    expect(demo.isExpired({ isDemo: false, expiresAt: past })).toBe(false);
    expect(demo.isExpired({ isDemo: true, expiresAt: null })).toBeFalsy();
    expect(demo.isExpired({ isDemo: true, expiresAt: new Date(Date.now() + 1e6).toISOString() })).toBe(false);
  });

  test('purge is due 30 days after expiry, not before', () => {
    const expired = (daysAgo) => ({ isDemo: true, expiresAt: new Date(Date.now() - daysAgo * 86400000).toISOString() });
    expect(demo.isPurgeDue(expired(29))).toBe(false);
    expect(demo.isPurgeDue(expired(31))).toBe(true);
    expect(demo.isPurgeDue({ isDemo: false, expiresAt: expired(60).expiresAt })).toBe(false);
  });

  test('cached demo state treats expired demos as expired', () => {
    const state = { isDemo: true, expiresAt: new Date(Date.now() - 1000).toISOString() };
    expect(demo.isDemoStateExpired(state)).toBe(true);
    expect(demo.isDemoStateExpired({ isDemo: true, expiresAt: null })).toBe(false);
    expect(demo.isDemoStateExpired({ isDemo: false, expiresAt: state.expiresAt })).toBe(false);
  });

  test('login url is slug-prefilled', () => {
    expect(demo.loginUrlFor('demo-x-1234')).toContain('/login?school=demo-x-1234');
  });

  test('six role logins are defined, including admin and student', () => {
    const keys = demo.DEMO_ROLE_LOGINS.map((r) => r.role);
    expect(keys).toEqual(expect.arrayContaining(['admin', 'deputy_principal', 'teacher', 'finance', 'parent', 'student']));
    expect(keys).toHaveLength(6);
  });
});
