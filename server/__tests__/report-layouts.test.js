/* ============================================================
   server/utils/report-layouts.js (RCE2)

   The layout registry itself: legacy_tabular's renderers are the
   original _drawReportPage/_computeReportHTML bodies moved verbatim
   (proven byte-for-byte unchanged by report-cards-ir.test.js's golden
   fixture, which calls router._buildPDFPage — the real dispatch path —
   not these functions directly). This file only covers the registry's
   own dispatch/fallback behavior, not layout content.
   ============================================================ */
'use strict';

const { LAYOUTS, getLayout } = require('../utils/report-layouts');

describe('getLayout — fallback dispatch', () => {
  test('a known key resolves to its own entry', () => {
    expect(getLayout('legacy_tabular')).toBe(LAYOUTS.legacy_tabular);
  });

  test('an unknown key falls back to legacy_tabular, never throws', () => {
    expect(getLayout('not_a_real_layout')).toBe(LAYOUTS.legacy_tabular);
  });

  test('undefined/null falls back to legacy_tabular (pre-engine snapshots with no layoutKey field)', () => {
    expect(getLayout(undefined)).toBe(LAYOUTS.legacy_tabular);
    expect(getLayout(null)).toBe(LAYOUTS.legacy_tabular);
  });

  test('every registered layout exposes both renderPdf and renderHtml as functions', () => {
    for (const key of Object.keys(LAYOUTS)) {
      expect(typeof LAYOUTS[key].renderPdf).toBe('function');
      expect(typeof LAYOUTS[key].renderHtml).toBe('function');
    }
  });
});
