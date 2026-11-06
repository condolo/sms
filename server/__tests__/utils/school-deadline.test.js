/* ============================================================
   school-deadline.js — a due time belongs to the school's clock.
   ============================================================ */
'use strict';

const { wallTimeInZone, deadlinePassed } = require('../../utils/school-deadline');

describe('school-local deadlines', () => {
  test('23:59 in Nairobi is 20:59 UTC (UTC+3, no DST)', () => {
    const ms = wallTimeInZone('2026-11-13', '23:59', 'Africa/Nairobi');
    expect(new Date(ms).toISOString()).toBe('2026-11-13T20:59:00.000Z');
  });

  test('23:59 UTC stays 23:59 UTC', () => {
    const ms = wallTimeInZone('2026-11-13', '23:59', 'UTC');
    expect(new Date(ms).toISOString()).toBe('2026-11-13T23:59:00.000Z');
  });

  test('a missing time defaults to end of day', () => {
    const ms = wallTimeInZone('2026-11-13', null, 'Africa/Nairobi');
    expect(new Date(ms).toISOString()).toBe('2026-11-13T20:59:00.000Z');
  });

  test('New York summer time is UTC-4, winter time UTC-5', () => {
    expect(new Date(wallTimeInZone('2026-07-01', '12:00', 'America/New_York')).toISOString())
      .toBe('2026-07-01T16:00:00.000Z');
    expect(new Date(wallTimeInZone('2026-01-15', '12:00', 'America/New_York')).toISOString())
      .toBe('2026-01-15T17:00:00.000Z');
  });

  test('the same instant is late in Nairobi before it is late in UTC', () => {
    const due = '2026-11-13';
    const at2059utc = Date.parse('2026-11-13T20:59:00.000Z');
    expect(deadlinePassed(due, '23:59', 'Africa/Nairobi', at2059utc)).toBe(false);
    expect(deadlinePassed(due, '23:59', 'Africa/Nairobi', at2059utc + 1000)).toBe(true);
    // Still before midnight UTC, but the Nairobi day has closed.
    expect(deadlinePassed(due, '23:59', 'UTC', at2059utc + 1000)).toBe(false);
  });

  test('no due date never expires', () => {
    expect(deadlinePassed(null, null, 'Africa/Nairobi', Date.now())).toBe(false);
  });
});
