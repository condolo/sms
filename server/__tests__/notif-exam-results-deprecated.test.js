/* ============================================================
   exam_results notification — dead since the Exams → Results retirement
   (v5.168.0). The registry entry stays (saved preferences still resolve)
   but is marked implemented:false so Settings disables it.
   ============================================================ */
'use strict';

const { EVENT_REGISTRY } = require('../utils/notif-settings');

describe('exam_results notification registry entry', () => {
  test('remains registered, so saved preferences still resolve', () => {
    expect(EVENT_REGISTRY.exam_results).toBeDefined();
    expect(EVENT_REGISTRY.exam_results.label).toBe('Exam Results Released');
  });

  test('is marked not implemented, because nothing sends it any more', () => {
    expect(EVENT_REGISTRY.exam_results.implemented).toBe(false);
  });
});
