/* ============================================================
   server/utils/notif-settings.js — getFrequency() + behaviour_incident
   event registration (new for the notification-activation work).
   ============================================================ */

let mockSchoolDoc;
jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({
    findOne: () => {
      const mockChain = { select: () => mockChain, lean: () => Promise.resolve(mockSchoolDoc) };
      return mockChain;
    },
  })),
}));

const { getFrequency, isEnabled, EVENT_REGISTRY, GROUPS } = require('../utils/notif-settings');

const SCHOOL = 'school_test_001';

beforeEach(() => { mockSchoolDoc = null; });

describe('behaviour_incident event registration', () => {
  test('is registered, implemented, and grouped under behaviour', () => {
    expect(EVENT_REGISTRY.behaviour_incident).toBeDefined();
    expect(EVENT_REGISTRY.behaviour_incident.implemented).toBe(true);
    expect(EVENT_REGISTRY.behaviour_incident.group).toBe('behaviour');
    expect(GROUPS.some(g => g.key === 'behaviour')).toBe(true);
  });
});

describe('getFrequency', () => {
  test('defaults to immediate when the school has no saved setting', async () => {
    mockSchoolDoc = { notificationSettings: {} };
    expect(await getFrequency(SCHOOL, 'behaviour_incident')).toBe('immediate');
  });

  test('returns daily_digest when explicitly saved', async () => {
    mockSchoolDoc = { notificationSettings: { behaviour_incident: { frequency: 'daily_digest' } } };
    expect(await getFrequency(SCHOOL, 'behaviour_incident')).toBe('daily_digest');
  });

  test('ignores an invalid saved value and falls back to immediate', async () => {
    mockSchoolDoc = { notificationSettings: { behaviour_incident: { frequency: 'weekly' } } };
    expect(await getFrequency(SCHOOL, 'behaviour_incident')).toBe('immediate');
  });

  test('an unknown event key defaults to immediate', async () => {
    expect(await getFrequency(SCHOOL, 'not_a_real_event')).toBe('immediate');
  });
});

describe('isEnabled — unaffected by the new event/frequency additions', () => {
  test('behaviour_incident respects a saved false setting', async () => {
    mockSchoolDoc = { notificationSettings: { behaviour_incident: { email: false } } };
    expect(await isEnabled(SCHOOL, 'behaviour_incident', 'email')).toBe(false);
  });
  test('behaviour_incident defaults to enabled with no saved setting', async () => {
    mockSchoolDoc = { notificationSettings: {} };
    expect(await isEnabled(SCHOOL, 'behaviour_incident', 'email')).toBe(true);
  });
});
