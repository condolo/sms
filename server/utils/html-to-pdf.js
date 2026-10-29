/* ============================================================
   Msingi — server-side HTML → PDF, via a single shared headless
   Chromium instance (Puppeteer).

   Why this exists: report-cards.js used to maintain TWO renderers for
   the same report (a native PDFKit one for downloads, an HTML one for
   the browser's own Print-to-PDF) — and they kept drifting apart
   (checkbox grid vs pills, "Total" vs "Total Incidents", a full-page
   cover vs a compact one, Arial vs embedded premium type), each time
   only noticed by someone comparing two actual downloaded files side
   by side. Printing the SAME HTML server-side, the same way a browser's
   own "Save as PDF" would, makes drift structurally impossible — there
   is only one renderer now, not two.

   Resource posture (this school's host is a Render Starter plan — 0.5
   CPU / 512MB, already flagged elsewhere as tight): the browser is
   launched LAZILY, on first use, not at server startup, and closed
   again after IDLE_CLOSE_MS of no requests so it never sits in memory
   during the long stretches nobody is downloading a report card. A
   crashed/disconnected browser is relaunched automatically on the next
   call rather than left broken until a server restart.
   ============================================================ */
'use strict';

const IDLE_CLOSE_MS = 5 * 60_000; // close the browser after 5 min of no renders
const LAUNCH_ARGS = [
  // Render's container has no setuid sandbox available — same posture
  // the project's own SSG pre-render step (client/scripts/prerender.mjs)
  // already runs its build-time Puppeteer with implicitly (Render's
  // build containers have the identical constraint).
  '--no-sandbox',
  '--disable-setuid-sandbox',
  // Keeps memory down — this process never needs GPU rendering.
  '--disable-gpu',
  // /dev/shm is tiny (or absent) on many small containers; Chromium
  // falls back to disk instead of crashing on a full /dev/shm.
  '--disable-dev-shm-usage',
];

let _browserPromise = null;
let _idleTimer       = null;

function _scheduleIdleClose() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(async () => {
    const browser = await _browserPromise?.catch(() => null);
    _browserPromise = null;
    if (browser) await browser.close().catch(() => {});
  }, IDLE_CLOSE_MS);
  _idleTimer.unref?.(); // never keeps the process alive just for this
}

async function _getBrowser() {
  // Puppeteer is heavy (bundles Chromium) — required lazily so every
  // other route in this server that never renders a PDF never pays for
  // loading it.
  const puppeteer = require('puppeteer');

  if (_browserPromise) {
    const existing = await _browserPromise.catch(() => null);
    if (existing && existing.connected) return existing;
    _browserPromise = null; // stale/disconnected — relaunch below
  }
  _browserPromise = puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  return _browserPromise;
}

/**
 * Render an HTML document to a PDF buffer, the same way a browser's own
 * "Print → Save as PDF" would — same page, same fonts, same CSS
 * @page/page-break rules the HTML renderers already write for exactly
 * this purpose (see report-layouts.js's @media print block).
 *
 * @param {string} html - a full HTML document (doctype through </html>)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=20000] - page-load + render timeout
 * @returns {Promise<Buffer>}
 */
async function htmlToPdfBuffer(html, { timeoutMs = 20_000 } = {}) {
  const browser = await _getBrowser();
  const page = await browser.newPage();
  try {
    // networkidle0 — this document's <img> tags (school logo, student
    // photo, watermark) are real remote URLs; print must wait for them
    // to actually load, not just for the markup to parse.
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: timeoutMs });
    const pdf = await page.pdf({
      // Every HTML layout already declares its own @page{margin:1.5cm;
      // size:A4} for exactly this purpose (printing from a real
      // browser) — preferCSSPageSize makes Puppeteer defer to that
      // instead of its own default format/margin, the same thing an
      // actual browser's Print dialog does. Omitting format/margin
      // here on purpose; setting either would silently override the
      // page's own @page rule instead of deferring to it.
      preferCSSPageSize: true,
      printBackground: true, // the HTML renderers rely on colored headers/pills/tables
      timeout: timeoutMs,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
    _scheduleIdleClose();
  }
}

/** Server shutdown hook — never leave a Chromium process orphaned. */
async function closeBrowser() {
  if (_idleTimer) clearTimeout(_idleTimer);
  const browser = await _browserPromise?.catch(() => null);
  _browserPromise = null;
  if (browser) await browser.close().catch(() => {});
}

/**
 * Merge several single-document PDF buffers (e.g. one per student from
 * htmlToPdfBuffer) into one PDF, in order — used by the bulk class
 * export, which used to build one shared PDFKit document page by page;
 * a browser-printed PDF is a finished document per call, so merging
 * afterwards (via pdf-lib, pure JS, no second browser involved) is the
 * equivalent for this renderer.
 *
 * @param {Buffer[]} buffers
 * @returns {Promise<Buffer>}
 */
async function mergePdfBuffers(buffers) {
  const { PDFDocument } = require('pdf-lib');
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}

module.exports = { htmlToPdfBuffer, closeBrowser, mergePdfBuffers };
