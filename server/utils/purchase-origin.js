/* ============================================================
   Msingi — Purchase Origin (2026-09, school-requested)

   Shared by Inventory items and Library books — both got the same
   "where was this bought" field in the same request (a school
   specifically wanted to distinguish local vs. China-imported stock).
   One list, not two independently maintained copies that could drift
   on values or labels — the exact class of bug this codebase has
   already found and fixed before (server/utils/guardian-contact.js's
   header references the same lesson).
   ============================================================ */
'use strict';

const PURCHASE_ORIGINS = ['local', 'imported_china', 'imported_other'];

const PURCHASE_ORIGIN_LABELS = {
  local:           'Local',
  imported_china:  'Imported — China',
  imported_other:  'Imported — Other',
};

module.exports = { PURCHASE_ORIGINS, PURCHASE_ORIGIN_LABELS };
