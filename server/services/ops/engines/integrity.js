/**
 * Integrity Engine
 * Runs all registered integrity rules and returns a structured report.
 * Rules are defined in ../integrity/rules.js — add new ones there.
 */
'use strict';

const RULES = require('../integrity/rules');

/**
 * @param {{ version?: string }} opts
 * @returns {Promise<{ rules: Array, summary: { total, critical, warn, ok, error } }>}
 */
async function run({ version } = {}) {
  const results = await Promise.all(
    RULES.map(async (rule) => {
      // Skip version-gated rules on older deployments
      if (rule.minVersion && version) {
        if (_semverLt(version, rule.minVersion)) {
          return { ...rule, status: 'skipped', count: 0, samples: [], skippedReason: `requires v${rule.minVersion}` };
        }
      }

      try {
        const { count, samples = [] } = await rule.run();
        return {
          id:       rule.id,
          module:   rule.module,
          label:    rule.label,
          severity: rule.severity,
          count,
          samples,
          status:   count === 0 ? 'ok' : rule.severity === 'critical' ? 'critical' : 'warn',
        };
      } catch (err) {
        return {
          id:       rule.id,
          module:   rule.module,
          label:    rule.label,
          severity: rule.severity,
          count:    -1,
          samples:  [],
          status:   'error',
          error:    err.message,
        };
      }
    })
  );

  const summary = {
    total:    results.length,
    critical: results.filter(r => r.status === 'critical').length,
    warn:     results.filter(r => r.status === 'warn').length,
    ok:       results.filter(r => r.status === 'ok').length,
    skipped:  results.filter(r => r.status === 'skipped').length,
    error:    results.filter(r => r.status === 'error').length,
  };

  return { rules: results, summary };
}

/* Minimal semver lt — only needed for major.minor.patch comparisons */
function _semverLt(a, b) {
  const [am, an, ap] = a.split('.').map(Number);
  const [bm, bn, bp] = b.split('.').map(Number);
  if (am !== bm) return am < bm;
  if (an !== bn) return an < bn;
  return (ap || 0) < (bp || 0);
}

module.exports = { run };
