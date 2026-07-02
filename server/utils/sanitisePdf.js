'use strict';

/**
 * Sanitise a string before passing it to PDFKit.
 *
 * Strips null bytes and ASCII control characters (0x00–0x1F excluding
 * tab 0x09, LF 0x0A, CR 0x0D) that can corrupt the PDF byte stream.
 * Limits length to prevent runaway allocations from untrusted input.
 *
 * @param {*}      value   — any value; non-strings are converted or returned as ''
 * @param {number} maxLen  — character cap (default 2000)
 * @returns {string}
 */
function sanitisePdfStr(value, maxLen = 2000) {
  if (value == null) return '';
  const str = String(value);
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // strip control chars except \t \n \r
    .slice(0, maxLen);
}

module.exports = { sanitisePdfStr };
