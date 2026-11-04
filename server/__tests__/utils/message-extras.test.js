/* ============================================================
   server/utils/message-extras.js — rich message validation

   A message stays ONE document; these tests pin the contract the
   teacher compose route and both thread reads rely on:
     • a plain sentence is still the default
     • a poll needs a question and 2–6 distinct options
     • a document is capped at 4 MB and never carries a poll
     • a reader sees their own vote + honest counts, not the raw map
   ============================================================ */
'use strict';

const { readExtras, pollView, messageExtras, KINDS } = require('../../utils/message-extras');

const DATA_URL = `data:text/plain;base64,${Buffer.from('hello').toString('base64')}`;

describe('readExtras', () => {
  test('a plain message stays plain', () => {
    const { extras, attachmentBlob } = readExtras({});
    expect(extras).toEqual({ kind: 'text', dueAt: null, context: null, attachment: null, poll: null });
    expect(attachmentBlob).toBeNull();
    expect(KINDS.has('text')).toBe(true);
  });

  test('a reminder keeps its due date as ISO', () => {
    const { extras } = readExtras({ kind: 'reminder', dueAt: '2026-11-02T15:00:00+03:00' });
    expect(extras.kind).toBe('reminder');
    expect(extras.dueAt).toBe('2026-11-02T12:00:00.000Z');
  });

  test('rejects an unknown kind and a non-date due date', () => {
    expect(readExtras({ kind: 'video' }).error).toMatch(/kind/i);
    expect(readExtras({ kind: 'reminder', dueAt: 'next tuesday' }).error).toMatch(/due date/i);
  });

  test('context is trimmed to its type and length budget', () => {
    const { extras } = readExtras({
      kind: 'homework',
      context: { type: 'attendance', title: 'Amina — October', detail: '3 absences' },
    });
    expect(extras.context).toEqual({ type: 'attendance', title: 'Amina — October', detail: '3 absences' });
    expect(readExtras({ context: { title: 'x'.repeat(121) } }).error).toMatch(/too long/i);
  });

  test('a poll dedupes options and starts with no votes', () => {
    const { extras } = readExtras({
      kind: 'poll',
      poll: { question: 'Sports day on Friday?', options: ['Yes', 'yes', 'No'] },
    });
    expect(extras.poll.question).toBe('Sports day on Friday?');
    expect(extras.poll.options.map((o) => o.text)).toEqual(['Yes', 'No']);
    expect(extras.poll.options.every((o) => o.id)).toBe(true);
    expect(extras.poll.votes).toEqual({});
  });

  test('a poll needs a question and at least two different options', () => {
    expect(readExtras({ kind: 'poll', poll: { options: ['Yes', 'No'] } }).error).toMatch(/question/i);
    expect(readExtras({ kind: 'poll', poll: { question: 'Q', options: ['Yes'] } }).error).toMatch(/two different/i);
    expect(readExtras({ kind: 'poll', poll: { question: 'Q', options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] } }).error)
      .toMatch(/at most 6/i);
  });

  test('poll options on a non-poll kind are refused', () => {
    expect(readExtras({ kind: 'text', poll: { question: 'Q', options: ['A', 'B'] } }).error).toMatch(/only a poll/i);
  });

  test('an attachment parses its data URL into a blob beside the card', () => {
    const { extras, attachmentBlob } = readExtras({
      kind: 'homework',
      attachment: { name: 'worksheet.pdf', dataUrl: DATA_URL },
    });
    expect(extras.attachment).toMatchObject({ name: 'worksheet.pdf', mimeType: 'text/plain', size: 5 });
    expect(attachmentBlob).toMatchObject({ name: 'worksheet.pdf', mimeType: 'text/plain', size: 5 });
    expect(Buffer.from(attachmentBlob.data, 'base64').toString()).toBe('hello');
  });

  test('a poll cannot carry a document, and junk bytes are refused', () => {
    expect(readExtras({
      kind: 'poll',
      poll: { question: 'Q', options: ['A', 'B'] },
      attachment: { name: 'x.pdf', dataUrl: DATA_URL },
    }).error).toMatch(/cannot carry a document/i);
    expect(readExtras({ attachment: { name: 'x.pdf', dataUrl: 'not-a-data-url' } }).error).toMatch(/could not be read/i);
  });
});

describe('pollView', () => {
  const poll = {
    question: 'Trip?',
    options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }],
    votes: { u1: 'o1', u2: 'o1', u3: 'o2' },
    closesAt: null,
  };

  test("counts every option and returns the reader's own choice", () => {
    const view = pollView(poll, 'u2');
    expect(view.options).toEqual([
      { id: 'o1', text: 'Yes', votes: 2 },
      { id: 'o2', text: 'No', votes: 1 },
    ]);
    expect(view.totalVotes).toBe(3);
    expect(view.myVote).toBe('o1');
    expect(view.closed).toBe(false);
  });

  test('a past closing date closes the poll', () => {
    const view = pollView({ ...poll, closesAt: '2020-01-01T00:00:00.000Z' }, 'u1');
    expect(view.closed).toBe(true);
  });

  test('no poll means no view', () => {
    expect(pollView(null, 'u1')).toBeNull();
  });
});

describe('messageExtras', () => {
  test('a legacy row reads as a plain text message', () => {
    expect(messageExtras({ body: 'hello' }, 'u1')).toEqual({
      kind: 'text', dueAt: null, context: null, attachment: null, poll: null,
    });
  });

  test('a poll view is per reader', () => {
    const message = {
      kind: 'poll',
      poll: { question: 'Q', options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }], votes: { u1: 'o2' } },
    };
    expect(messageExtras(message, 'u1').poll.myVote).toBe('o2');
    expect(messageExtras(message, 'u2').poll.myVote).toBeNull();
  });
});
