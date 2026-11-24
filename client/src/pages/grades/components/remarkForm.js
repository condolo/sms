/* ============================================================
   Report remarks form — keep what is typed, take what was saved.

   A report card can be on screen before its saved remarks arrive, and
   saving one learner's comment refetches everyone's. Each field is
   compared with the value it was last loaded with (`base`):
     - untouched here  → take the saved value
     - edited here     → keep the typed value
   Before v5.280.0 a card that loaded first compared its empty fields with
   the saved remarks, saw them as "edited", stayed empty, and could save
   that emptiness on the next class/term/year/cycle switch.
   ============================================================ */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Field by field: the typed value where it was edited, else the saved one. */
export function mergeRemarks(local, base, incoming) {
  const out = { ...local };
  for (const k of Object.keys(incoming)) {
    if (same(local[k], base[k])) out[k] = incoming[k];
  }
  return out;
}

/** Was any of `base`'s fields edited? */
export function remarksDirty(local, base) {
  return Object.keys(base).some(k => !same(local[k], base[k]));
}
