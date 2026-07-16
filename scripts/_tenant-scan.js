/**
 * _tenant-scan.js — shared scanner for direct _model() use in routes (internal module)
 *
 * Supports the C4/ADR-0001 ratchet: as routes migrate to tenantModel(),
 * direct _model('<tenant-collection>') call sites in server/routes/ must
 * only ever DECREASE. This module reports the current count so
 * verify-tenant-coverage.js can enforce non-increase.
 *
 * "Tenant-owned" is defined by the SAME PLATFORM_COLLECTIONS set the
 * runtime uses (imported from server/utils/tenant-model) — one source of
 * truth, never duplicated.
 *
 * Only server/routes/ is scanned: platform/migration/util code
 * legitimately uses _model() directly. Dynamic _model(<var>) calls can't
 * be classified statically, so they are surfaced separately for manual
 * review rather than silently ignored or counted.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { PLATFORM_COLLECTIONS } = require('../server/utils/tenant-model');

const ROUTES_DIR = path.join(__dirname, '../server/routes');

const MODEL_LITERAL_RE = /_model\(\s*['"`]([a-zA-Z_]+)['"`]\s*\)/g;
const MODEL_DYNAMIC_RE = /_model\(\s*(?!['"`])[a-zA-Z_$]/g;   // _model(variable…)

/**
 * @returns {{ tenantOwnedCount:number, platformExemptCount:number,
 *             byFile:Object<string,Array>, dynamic:Array }}
 */
module.exports = function scanTenantModelUsage() {
  const byFile  = {};
  const dynamic = [];
  let tenantOwnedCount   = 0;
  let platformExemptCount = 0;

  for (const file of fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js')).sort()) {
    const source = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');

    let m;
    MODEL_LITERAL_RE.lastIndex = 0;
    while ((m = MODEL_LITERAL_RE.exec(source)) !== null) {
      const coll = m[1];
      const line = source.slice(0, m.index).split('\n').length;
      if (PLATFORM_COLLECTIONS.has(coll)) { platformExemptCount++; continue; }
      tenantOwnedCount++;
      (byFile[file] ||= []).push({ collection: coll, line });
    }

    MODEL_DYNAMIC_RE.lastIndex = 0;
    while ((m = MODEL_DYNAMIC_RE.exec(source)) !== null) {
      const line = source.slice(0, m.index).split('\n').length;
      dynamic.push({ file, line });
    }
  }

  return { tenantOwnedCount, platformExemptCount, byFile, dynamic };
};
