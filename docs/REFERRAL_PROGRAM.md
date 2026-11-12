# Referral program

Platform growth program: **anyone can refer a school**. This is separate from a school's own
"Referral" **fee** discount for parents (`students.isReferralFamily` / `discount_policies.type='referral'`),
which remains school-side and is not touched by this feature.

> The program ships **closed** (`enabled: false`). Review the bounty and referee incentive in
> Platform → Referrals and switch it on when ready; the public `/refer` page says the program is
> closed until then.

## Why it works this way

- A referrer is not necessarily a school user, so partners are their own record with no platform login.
- The school is attributed **once, at signup** (onboarding form, demo request, or operator provisioning).
  A bad code fails the signup loudly instead of being silently dropped.
- A conversion is the referred school's **first actual subscription payment** — not signup, not an invoice.
- The bounty is snapshotted on the conversion row at that moment. Later settings changes never rewrite
  a promised reward.
- Payouts are manual. The partner saves their payout destination and requests a payout from the dashboard;
  an operator reviews the request and marks it paid with a real M-Pesa/bank reference.

## Data model

| Collection | Purpose |
| --- | --- |
| `referral_partners` | Code, contact details, payout destination (M-Pesa or bank), status (`active`/`blocked`), SHA-256 hash of the private hub token. Unique `code`, `email`, `hubTokenHash`. |
| `referral_conversions` | One per school (unique `schoolId`). Bounty snapshot, trigger, payment reference, `rewardStatus` (`pending`/`paid`), `payoutRequestId` while locked in a request. |
| `referral_payout_requests` | Manual payout queue: partner, amount, currency, locked conversion ids, payout snapshot, status (`requested`/`paid`/`rejected`), reference/rejection reason. One open request per partner (partial unique index). |
| `schools` (added fields) | `referralCode`, `referralPartnerId`, `referralAttributedAt`, `referralSource`. |
| `demo_requests` (added fields) | The same attribution fields, carried onto the school at provisioning. |
| `platform_settings.referralProgram` | Dynamic program config (below). |
| `billing_snapshots` (added fields) | `originalAmount` + `referralDiscount { type, value, amount, currency, code, partnerId }` on the first invoice only. |

## Program settings (dynamic)

Stored on the singleton `platform_settings` doc; defaults apply when the field is absent.

```js
referralProgram: {
  enabled: false,                    // closed until an operator turns it on
  bountyAmount: 5000,                // KES per converted school
  currency: 'KES',
  codePrefix: 'MSINGI',
  refereeIncentive: { type: 'none', value: 0 }, // none | percent | fixed
  termsUrl: '/terms',
}
```

`type: 'percent'` / `'fixed'` discounts the referred school's **first platform invoice only**. It is applied
when the first `billing_snapshots` row is created, and never again. A `fixed` amount is clamped to the invoice
total; a 100% discount produces a zero invoice and the M-Pesa collection route returns `NOTHING_DUE` rather
than trying to charge zero.

## Flow

1. **Join** — `/refer`, linked from the public nav ("Refer & Earn") and footer. `POST /api/referrals/partners`
   (public, 5/hour/IP) returns the code, two share links (`/onboard?ref=CODE`, `/demo?ref=CODE`) and the
   private hub link; all are shown on screen and emailed.
1a. **Recover the dashboard link** — `/refer/login` (also linked from `/refer` and the footer). The partner
   enters their signup email; we re-send the private link. The response is deliberately generic, and a new
   link rotates the old token — but the previous link stays valid for a **15-minute grace window**, so a
   resend can never strand the partner (or be used by a third party to kill their link).
2. **Attribute** — the school enters the code on onboarding, the demo request form, or an operator attaches it
   to an existing school. `resolveAttribution()` rejects unknown or blocked codes and self-referral (same email).
3. **First invoice** — `createBillingSnapshot()` applies the referee incentive if configured, on the school's
   first snapshot only.
4. **Convert** — `POST /api/mpesa/subscription/callback` records a conversion after the first subscription
   payment. Offline/bank deals are recorded by an operator at
   `POST /api/platform/referrals/schools/:id/convert`. Idempotent per school; renewals do not pay twice.
5. **Payout details** — the partner opens their dashboard, chooses M-Pesa or bank transfer and saves the
   destination. Changes are locked while a request is under review.
6. **Request payout** — the partner requests the currently-available rewards. This creates a
   `referral_payout_requests` row and locks those conversions; it does not move money.
7. **Settle manually** — an operator reviews the request in Platform → Referrals and either marks it paid
   (reference required) or rejects it. Rejecting unlocks the conversions for a future request.

## API

### Public (no auth)
- `GET /api/referrals/program` — public terms (enabled, bounty, incentive, terms URL). No code prefix.
- `POST /api/referrals/partners` — join the program.
- `POST /api/referrals/partners/resend` — email a fresh private dashboard link (generic response, token rotates).
- `GET /api/referrals/validate?code=...` — form-time validation; boolean only, never partner details.
- `GET /api/referrals/hub/:token` — private partner dashboard data.
- `PATCH /api/referrals/hub/:token/payout-details` — save M-Pesa/bank payout destination.
- `POST /api/referrals/hub/:token/payout-requests` — request a manual payout of available rewards.

### Platform console (capabilities `referrals.view` / `referrals.manage`)
- `GET /api/platform/referrals` — partners, program settings, totals.
- `GET|PUT /api/platform/referrals/settings` — read/update the dynamic program.
- `GET /api/platform/referrals/:id` — partner detail and every referred school.
- `PATCH /api/platform/referrals/:id` — block/reactivate a partner, or correct payout details.
- `POST /api/platform/referrals/:id/payouts` — settle unlocked conversions directly (all, or selected ids).
- `POST /api/platform/referrals/payout-requests/:id/pay` — settle a partner's requested payout (reference required).
- `POST /api/platform/referrals/payout-requests/:id/reject` — reject and unlock the request's conversions.
- `POST /api/platform/referrals/schools/:id/convert` — record an offline first payment.
- `POST /api/platform/schools/:id/referral` — attach or correct a school's code (`force: true` replaces).

## Operator runbook

- **Program live?** Platform → Referrals → open/close. Closing stops new partners and new conversions; existing
  pending rewards still show and can be paid. A first payment received while the program was closed is not
  auto-converted — reopen and use "Record payment" on that school.
- **Suspicious partner?** Block them. New signups with the code are rejected; existing conversions stay visible
  so Finance can decide whether to pay them.
- **Wrong attribution?** Platform → Referrals → "Attach a code to an existing school" with "Replace" checked.
- **Lost dashboard link?** Send the partner to `/refer/login`, or open it yourself as a test. The old link stops
  working once a new one is issued; the email is the only place the new link is delivered.
- **Wrong payout details?** Open the partner → "Payout details". Partners can also edit M-Pesa/bank details from their own dashboard before requesting a payout.
- **Payout requested?** Open the partner → review the request (amount, method, destination). "Mark paid" requires the M-Pesa/bank reference; "Reject" unlocks the rewards for a future request.
- **Offline school paid by bank?** Open the partner → "Record payment" on that school, then settle the request (or "Pay unlocked") with a reference.

## Anti-abuse and honest limits

- Codes are unique by index; generation retries then fails cleanly. Hub tokens are stored only as hashes.
- Self-referral by the same email is refused. Blocked partners cannot earn.
- **Self-referral by a second email is not technically detectable.** The final control is the manual payout
  review: before marking a payout paid, check that the partner and the school's admin are not the same person
  or institution. The console shows both names, emails and the referred school.
- Public creation is rate-limited per IP but **not email-verified in v1** — a code is issued immediately.
  Abuse has little value because a payout requires a real school and a real first payment.
- Payout details are editable through the bearer dashboard link. A leaked link can change the destination, so
  payouts are reviewed manually and the operator should verify the destination with the partner before paying.
  Details are locked while a request is under review, and every change emails **the partner and platform ops**
  (so a hijacked link is visible to staff before money moves).
- A payout request can only be settled once: the row write arbitrates, so two operators (or a retry) cannot
  both mark it paid, and a settled request cannot then be rejected into releasing its lock.
- Refunds/clawbacks after a reward is paid are not automated; handle manually and document in the partner note.
- Attribution is intentionally write-once at signup. Operators can correct it explicitly with `force`.

## Files

- `server/services/referralService.js` — codes, attribution, conversion, payouts, discount calculation.
- `server/routes/referrals.js` — public API.
- `server/routes/platform.js` — operator API (appended referral section).
- `server/routes/onboard.js`, `server/services/demoService.js`, `server/routes/demo.js` — signup attribution.
- `server/routes/billing.js` — first-invoice discount.
- `server/routes/mpesa.js` — first-payment conversion + discounted STK amount.
- `server/utils/indexes.js` — unique code/email/hub-token/school indexes, plus one-open-request partial index.
- `client/src/pages/ReferralHub.jsx` — payout destination editor, request button and request history.
- `client/src/pages/ReferralProgram.jsx`, `client/src/pages/ReferralLogin.jsx`, `client/src/pages/ReferralHub.jsx`, `client/src/App.jsx`, `client/src/pages/DemoRequest.jsx`,
  `SettingsPage.jsx` (subscription tab), `PublicFooter.jsx`.
- `onboard.html`, `platform.html`.
