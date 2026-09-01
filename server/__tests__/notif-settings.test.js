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

describe('report_comment_step event registration (RC8)', () => {
  test('is registered, implemented, in-app by default, grouped under academic', () => {
    expect(EVENT_REGISTRY.report_comment_step).toBeDefined();
    expect(EVENT_REGISTRY.report_comment_step.implemented).toBe(true);
    expect(EVENT_REGISTRY.report_comment_step.group).toBe('academic');
    expect(EVENT_REGISTRY.report_comment_step.channels).toEqual({ email: false, inApp: true });
  });

  test('a school with no saved settings gets the default (in-app enabled)', async () => {
    mockSchoolDoc = null;
    expect(await isEnabled(SCHOOL, 'report_comment_step', 'inApp')).toBe(true);
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

describe('platform_impersonation event registration (PLAT-01)', () => {
  test('is registered, implemented, alwaysOn, grouped under account', () => {
    expect(EVENT_REGISTRY.platform_impersonation).toBeDefined();
    expect(EVENT_REGISTRY.platform_impersonation.implemented).toBe(true);
    expect(EVENT_REGISTRY.platform_impersonation.alwaysOn).toBe(true);
    expect(EVENT_REGISTRY.platform_impersonation.group).toBe('account');
    expect(EVENT_REGISTRY.platform_impersonation.channels).toEqual({ email: true, inApp: true });
  });

  test('THE CRITICAL PROPERTY: a school cannot silence it — isEnabled ignores an explicit saved {email:false, inApp:false}', async () => {
    mockSchoolDoc = { notificationSettings: { platform_impersonation: { email: false, inApp: false } } };
    expect(await isEnabled(SCHOOL, 'platform_impersonation', 'email')).toBe(true);
    expect(await isEnabled(SCHOOL, 'platform_impersonation', 'inApp')).toBe(true);
  });

  test('stays enabled with no saved settings at all', async () => {
    mockSchoolDoc = null;
    expect(await isEnabled(SCHOOL, 'platform_impersonation', 'email')).toBe(true);
  });
});
