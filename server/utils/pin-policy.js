/* ============================================================
   Msingi — the app-lock PIN policy, server side.

   Mirrors the app's lib/pin-policy.ts. The app checks for UX; this copy
   exists because the app is not trusted. Keep the two lists in step — a
   PIN the app refuses but the server accepts (or the reverse) becomes a
   support ticket that cannot be reproduced.
   ============================================================ */
'use strict';

const PIN_LENGTH = 4;

const WEAK = new Set([
  '1234',
  '4321',
  '0123',
  '9876',
  '2580', // the on-screen keypad's centre column — trivially shoulder-surfed
]);

function isPinShaped(pin) {
  return typeof pin === 'string' && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/** Why this PIN may not be used, or null when it is fine. */
function pinProblem(pin) {
  if (!isPinShaped(pin)) return `Choose ${PIN_LENGTH} digits.`;
  if (WEAK.has(pin) || /^(\d)\1{3}$/.test(pin)) {
    return 'That PIN is too easy to guess. Choose something else.';
  }
  return null;
}

module.exports = { PIN_LENGTH, isPinShaped, pinProblem };
