/* ============================================================
   server/utils/notificationTemplates.js

   Reported directly: schools want to "own the message" — every
   automated email (welcome, password reset, etc.) reads as if
   Msingi wrote it, with no way for a school to put it in their
   own words. This pins: override wins over default, missing
   override falls back to default, {{placeholders}} substitute
   correctly, unknown placeholders degrade to '' rather than
   throwing, user-supplied text is HTML-escaped, and the override
   read/write/reset routes update the right school doc.

   All DB calls mocked — no MongoDB required.
   ============================================================ */
'use strict';

let mockSchoolDoc = null;
const mockUpdateOne = jest.fn(() => Promise.resolve({}));

jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({
    findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }),
    updateOne: (...args) => mockUpdateOne(...args),
  })),
}));

const {
  resolveMessageTemplate,
  listTemplatesForSchool,
  setTemplateOverride,
  resetTemplateOverride,
  substitute,
  bodyToHtml,
} = require('../utils/notificationTemplates');

beforeEach(() => {
  mockSchoolDoc = null;
  mockUpdateOne.mockClear();
});

describe('substitute()', () => {
  test('replaces known {{placeholders}}', () => {
    expect(substitute('Hi {{name}}, welcome to {{schoolName}}', { name: 'Amina', schoolName: 'Trinitas' }))
      .toBe('Hi Amina, welcome to Trinitas');
  });

  test('unknown placeholder degrades to empty string, never throws', () => {
    expect(substitute('Hi {{name}}, {{unknownToken}}!', { name: 'Amina' })).toBe('Hi Amina, !');
  });

  test('null/undefined input returns empty string', () => {
    expect(substitute(null)).toBe('');
    expect(substitute(undefined)).toBe('');
  });
});

describe('bodyToHtml()', () => {
  test('splits blank-line-separated blocks into separate <p> tags', () => {
    const html = bodyToHtml('First paragraph.\n\nSecond paragraph.');
    expect(html).toBe('<p>First paragraph.</p>\n<p>Second paragraph.</p>');
  });

  test('escapes HTML special characters from school-authored text', () => {
    const html = bodyToHtml('Use <script>alert(1)</script> & "quotes"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  test('a single newline within a block becomes <br>, not a new paragraph', () => {
    const html = bodyToHtml('Line one\nLine two');
    expect(html).toBe('<p>Line one<br>Line two</p>');
  });
});

describe('resolveMessageTemplate()', () => {
  test('falls back to the registry default when school has no override', async () => {
    mockSchoolDoc = { notificationTemplateOverrides: {} };
    const { subject, bodyHtml } = await resolveMessageTemplate('sch_1', 'password_changed', { name: 'Amina', schoolName: 'Trinitas' });
    expect(subject).toBe('Password changed — Trinitas');
    expect(bodyHtml).toContain('Amina');
    expect(bodyHtml).toContain('Trinitas');
  });

  test("school's own override wins over the default", async () => {
    mockSchoolDoc = {
      notificationTemplateOverrides: {
        password_changed: { subject: 'Your {{schoolName}} password is updated', body: 'Hey {{name}}! All set.' },
      },
    };
    const { subject, bodyHtml } = await resolveMessageTemplate('sch_1', 'password_changed', { name: 'Amina', schoolName: 'Trinitas' });
    expect(subject).toBe('Your Trinitas password is updated');
    expect(bodyHtml).toBe('<p>Hey Amina! All set.</p>');
  });

  test('a partial override (subject only) keeps the default body, and vice versa', async () => {
    mockSchoolDoc = { notificationTemplateOverrides: { password_changed: { subject: 'Custom subject only' } } };
    const r1 = await resolveMessageTemplate('sch_1', 'password_changed', { name: 'Amina', schoolName: 'Trinitas' });
    expect(r1.subject).toBe('Custom subject only');
    expect(r1.bodyHtml).toContain('Trinitas');

    mockSchoolDoc = { notificationTemplateOverrides: { password_changed: { body: 'Custom body only' } } };
    const r2 = await resolveMessageTemplate('sch_1', 'password_changed', { name: 'Amina', schoolName: 'Trinitas' });
    expect(r2.subject).toBe('Password changed — Trinitas');
    expect(r2.bodyHtml).toBe('<p>Custom body only</p>');
  });

  test('no schoolId (platform-level send) always uses the default, no DB lookup needed', async () => {
    const { subject } = await resolveMessageTemplate(null, 'password_changed', { name: 'Amina', schoolName: 'Trinitas' });
    expect(subject).toBe('Password changed — Trinitas');
  });

  test('unknown template key throws rather than silently sending a broken email', async () => {
    await expect(resolveMessageTemplate('sch_1', 'not_a_real_key', {})).rejects.toThrow(/Unknown notification template key/);
  });

  test('a DB error on the override lookup fails open to the default, not a thrown error', async () => {
    const { _model } = require('../utils/model');
    _model.mockImplementationOnce(() => ({ findOne: () => ({ lean: () => Promise.reject(new Error('mongo down')) }) }));
    const { subject } = await resolveMessageTemplate('sch_1', 'password_changed', { name: 'Amina', schoolName: 'Trinitas' });
    expect(subject).toBe('Password changed — Trinitas');
  });
});

describe('listTemplatesForSchool()', () => {
  test('marks only actually-overridden keys as isOverridden, others show the default', async () => {
    mockSchoolDoc = { notificationTemplateOverrides: { password_changed: { subject: 'x', body: 'y', updatedAt: '2026-10-26T00:00:00.000Z' } } };
    const list = await listTemplatesForSchool('sch_1');
    const pc = list.find(t => t.key === 'password_changed');
    const wc = list.find(t => t.key === 'welcome_user');
    expect(pc.isOverridden).toBe(true);
    expect(pc.subject).toBe('x');
    expect(wc.isOverridden).toBe(false);
    expect(wc.subject).toBe(wc.defaultSubject);
  });
});

describe('setTemplateOverride() / resetTemplateOverride()', () => {
  test('rejects an unknown key before writing anything', async () => {
    await expect(setTemplateOverride('sch_1', 'bogus_key', { subject: 'x', body: 'y' })).rejects.toThrow(/Unknown notification template key/);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  test('rejects empty subject/body', async () => {
    await expect(setTemplateOverride('sch_1', 'password_changed', { subject: '', body: 'y' })).rejects.toThrow(/subject is required/);
    await expect(setTemplateOverride('sch_1', 'password_changed', { subject: 'x', body: '' })).rejects.toThrow(/body is required/);
  });

  test('rejects oversized subject/body', async () => {
    await expect(setTemplateOverride('sch_1', 'password_changed', { subject: 'x'.repeat(301), body: 'y' })).rejects.toThrow(/300 characters/);
    await expect(setTemplateOverride('sch_1', 'password_changed', { subject: 'x', body: 'y'.repeat(4001) })).rejects.toThrow(/4000 characters/);
  });

  test('writes a trimmed override scoped to this school and this key only', async () => {
    await setTemplateOverride('sch_1', 'password_changed', { subject: '  Custom subject  ', body: '  Custom body  ' }, 'u_admin1');
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ id: 'sch_1' });
    expect(update.$set['notificationTemplateOverrides.password_changed']).toMatchObject({
      subject: 'Custom subject',
      body: 'Custom body',
      updatedBy: 'u_admin1',
    });
  });

  test('reset unsets only the one key for this school', async () => {
    await resetTemplateOverride('sch_1', 'password_changed');
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toEqual({ id: 'sch_1' });
    expect(update.$unset).toEqual({ 'notificationTemplateOverrides.password_changed': '' });
  });

  test('reset on an unknown key throws before touching the DB', async () => {
    await expect(resetTemplateOverride('sch_1', 'bogus_key')).rejects.toThrow(/Unknown notification template key/);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});
