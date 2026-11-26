const {
  renderOutreachEmail,
  safeUrl,
  unresolvedPlaceholders,
  validateTemplate,
} = require('../utils/outreach-email-template');
const { DEFAULT_TEMPLATES } = require('../services/outreachService');

const lead = {
  schoolName: 'Kivuli <Academy>', contactName: 'Grace', city: 'Nairobi', country: 'Kenya', curriculum: 'CBC',
};

describe('outreach email renderer', () => {
  test('renders branded, responsive HTML and a plain-text alternative', () => {
    const result = renderOutreachEmail({
      template: DEFAULT_TEMPLATES[0], lead, campaign: { id: 'camp_1' },
      sender: { name: 'Amina', role: 'Schools Team' },
      unsubscribeUrl: 'https://msingi.io/api/outreach/unsubscribe/token', stepIndex: 0,
    });

    expect(result.subject).toContain('Kivuli <Academy>');
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('@media only screen and (max-width:620px)');
    expect(result.html).toContain('background:#0f172a');
    expect(result.html).toContain('background:#00e898');
    expect(result.html).toContain('v:roundrect');
    expect(result.html).toContain('https://msingi.io/api/public/platform-asset/logo');
    expect(result.html).toContain('https://wa.me/254769024153');
    expect(result.html).toContain('Kivuli &lt;Academy&gt;');
    expect(result.html).not.toContain('Kivuli <Academy>');
    expect(result.html).toContain('utm_campaign=camp_1');
    expect(result.html).toContain('https://msingi.io/api/outreach/unsubscribe/token');
    expect(result.text).toContain('Unsubscribe: https://msingi.io/api/outreach/unsubscribe/token');
  });

  test('uses the promised CTA destination for follow-ups', () => {
    const result = renderOutreachEmail({
      template: DEFAULT_TEMPLATES[4], lead, campaign: { id: 'camp_1' },
      sender: { name: 'Amina' }, unsubscribeUrl: 'https://example.test/unsubscribe', stepIndex: 1,
    });
    expect(result.subject).toBe('One part of Msingi that may help Kivuli <Academy>');
    expect(result.html).toContain('https://msingi.io/contact');
  });

  test('rejects unsafe CTA protocols', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('https://msingi.io/contact');
    expect(safeUrl('https://msingi.io/demo')).toBe('https://msingi.io/demo');
  });

  test('finds unresolved placeholders and validates content blocks', () => {
    expect(unresolvedPlaceholders('Hello {{school_name}} {{unknown}}')).toEqual(['school_name', 'unknown']);
    expect(validateTemplate(DEFAULT_TEMPLATES[0])).toEqual([]);
    expect(validateTemplate({ ...DEFAULT_TEMPLATES[0], subject: 'Hi {{school_nam}}' })).toEqual(expect.arrayContaining([
      expect.stringContaining('Unknown placeholder(s) in subject: school_nam'),
    ]));
    expect(validateTemplate({ subject: '', headline: '', intro: '', benefits: [] })).toEqual(expect.arrayContaining([
      'Subject is required.', 'Headline is required.', 'Introduction is required.',
    ]));
  });
});
