/* ============================================================
   server/utils/lesson-plan-pdf.js — fetchImageBuf

   Same root cause and fix as report-cards.js's own _fetchImageBuf (see
   that file's test for the full write-up, reported directly 2026-10-27):
   this was a verbatim copy of the same relative-URL bug — settings.js's
   logo-upload flow always writes a relative, self-hosted `logoUrl`
   (`/api/public/school-asset/logo?slug=...`), which a server-side
   http(s).get() can't resolve without first making it absolute.
   ============================================================ */
'use strict';

function mockFakeGet(url, optsOrCb, maybeCb) {
  global.__lastRequestedUrl = url;
  const callback = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
  const resp = { on: (event, cb) => {
    if (event === 'data') (global.__mockResponseChunks || [Buffer.from('fake-image-bytes')]).forEach(cb);
    if (event === 'end') cb();
    return resp;
  } };
  if (typeof callback === 'function') callback(resp);
  const req = { on: () => req, destroy: () => {} };
  return req;
}
jest.mock('http', () => ({ ...jest.requireActual('http'), get: (...args) => mockFakeGet(...args) }));
jest.mock('https', () => ({ ...jest.requireActual('https'), get: (...args) => mockFakeGet(...args) }));
jest.mock('../../utils/app-url', () => ({ appUrl: (p = '') => `https://app.example.test${p.startsWith('/') ? p : `/${p}`}` }));

const { fetchImageBuf } = require('../../utils/lesson-plan-pdf');

beforeEach(() => {
  global.__lastRequestedUrl = null;
  global.__mockResponseChunks = [Buffer.from('fake-image-bytes')];
});

describe('fetchImageBuf', () => {
  test('a relative, self-hosted logoUrl is resolved against the app base URL before fetching', async () => {
    const buf = await fetchImageBuf('/api/public/school-asset/logo?slug=sch_demo');
    expect(global.__lastRequestedUrl).toBe('https://app.example.test/api/public/school-asset/logo?slug=sch_demo');
    expect(buf.toString()).toBe('fake-image-bytes');
  });

  test('an already-absolute http(s) URL is fetched unchanged', async () => {
    await fetchImageBuf('https://cdn.example.com/logo.png');
    expect(global.__lastRequestedUrl).toBe('https://cdn.example.com/logo.png');
  });

  test('a data: URI is decoded directly, never sent to http/https.get', async () => {
    const buf = await fetchImageBuf(`data:image/png;base64,${Buffer.from('hi').toString('base64')}`);
    expect(buf.toString()).toBe('hi');
    expect(global.__lastRequestedUrl).toBeNull();
  });

  test('null/empty/garbage input still resolves to null, not a crash', async () => {
    expect(await fetchImageBuf(null)).toBeNull();
    expect(await fetchImageBuf('')).toBeNull();
    expect(await fetchImageBuf('not a url at all')).toBeNull();
    expect(global.__lastRequestedUrl).toBeNull();
  });
});
