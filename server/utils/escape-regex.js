/* ============================================================
   escapeRegex — make a user-supplied string safe to use as a
   MongoDB regex.

   Free-text search boxes (the audit log's search, the users list's
   "search name or email") take raw input and hand it to Mongo as a
   $regex. An unescaped string is both a crash risk — an unbalanced
   "[" throws a BSON error that surfaces to the user as a 500 — and a
   cheap way to make the database walk far more of the collection than
   intended ("a{20}"-style patterns). Escaping every non-literal
   character means the term is MATCHED, never interpreted.

   Usage:
     const needle = escapeRegex(q);
     Model.find({ name: { $regex: needle, $options: 'i' } })
   ============================================================ */
'use strict';

function escapeRegex(str) {
  return String(str ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { escapeRegex };
