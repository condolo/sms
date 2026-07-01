/**
 * Operations Engine — single entry point for all platform health checks.
 *
 * Exposes four engines:
 *   health     — infrastructure (DB, uptime, storage, email)
 *   integrity  — data correctness (orphans, missing IDs, duplicates)
 *   compliance — governance (RBAC, tenant isolation, audit, backups)
 *   release    — certificate persistence and history
 *
 * Usage:
 *   const ops = require('./services/ops');
 *   const report = await ops.fullReport({ version: '4.28.0' });
 */
'use strict';

const healthEngine    = require('./engines/health');
const integrityEngine = require('./engines/integrity');
const complianceEngine = require('./engines/compliance');
const releaseEngine   = require('./engines/release');

/**
 * Run all engines and return a unified platform health report.
 */
async function fullReport({ version } = {}) {
  const startedAt = Date.now();

  const [health, integrity, compliance] = await Promise.all([
    healthEngine.run().catch(err => ({ error: err.message })),
    integrityEngine.run({ version }).catch(err => ({ error: err.message })),
    // compliance is synchronous (file/env checks) — wrap in promise
    Promise.resolve().then(() => complianceEngine.run()).catch(err => ({ error: err.message })),
  ]);

  const verdict = _deriveVerdict({ health, integrity, compliance });

  return {
    generatedAt: new Date().toISOString(),
    durationMs:  Date.now() - startedAt,
    version,
    verdict,
    health,
    integrity,
    compliance,
  };
}

function _deriveVerdict({ health, integrity, compliance }) {
  const healthDown    = (health.summary?.down    ?? 0) > 0;
  const intCritical   = (integrity.summary?.critical ?? 0) > 0;
  const compFailed    = (compliance.summary?.failed  ?? 0) > 0;

  if (healthDown || intCritical || compFailed) return 'ATTENTION_REQUIRED';
  const hasWarnings = (health.summary?.degraded ?? 0) > 0
    || (integrity.summary?.warn ?? 0) > 0
    || (compliance.summary?.warned ?? 0) > 0;
  return hasWarnings ? 'WARNINGS' : 'CERTIFIED';
}

module.exports = {
  fullReport,
  health:     healthEngine,
  integrity:  integrityEngine,
  compliance: complianceEngine,
  release:    releaseEngine,
};
