# Platform Outreach — Implementation Review Target

Date: 2026-11-25
Branch: `feat/platform-outreach`
Review mode: EGM implementation readiness (Stage 9)

## Scope

Review the implemented prospect-school outreach feature on the branch, including the follow-up styling update that changes the email renderer to the green/gold Msingi identity.

The feature adds:

- A platform-only Outreach workspace at `/platform`.
- CSV lead import, search, status workflow, notes and demo-request linkage.
- Six branded email templates with desktop/mobile preview and test send.
- Three-touch campaigns with weekday scheduling, daily caps, pause/resume/cancel and retry.
- A durable Mongo-backed send queue.
- Suppression checks before every send and signed one-click unsubscribe links.
- Separate `outreach.view`, `outreach.manage` and `outreach.send` capabilities.
- A green/gold responsive email design with hosted Msingi logo, cream benefit cards, dark-green discovery panel, gold CTA, WhatsApp contact and trust/pricing footer.

## Primary files

- `server/services/outreachService.js`
- `server/routes/platform-outreach.js`
- `server/routes/outreach-public.js`
- `server/utils/outreach-email-template.js`
- `server/utils/email.js`
- `server/config/platformCapabilities.js`
- `server/middleware/auth.js`
- `server/utils/tenant-model.js`
- `server/utils/indexes.js`
- `server/index.js`
- `js/platform-outreach.js`
- `platform.html`
- `css/platform.css`
- `client/public/msingi-outreach-logo.png`
- `.env.example`
- `render.yaml`
- `docs/platform-outreach.md`

## Tests to inspect

- `server/__tests__/outreach-service.test.js`
- `server/__tests__/outreach-email-template.test.js`
- `server/__tests__/routes/platform-outreach-routes.test.js`
- `server/__tests__/routes/outreach-public-routes.test.js`
- `server/__tests__/routes/platform-policy-coverage.test.js`
- `server/__tests__/platform-capabilities.test.js`
- `server/__tests__/email-school-routing.test.js`

## Verification already performed

- Focused outreach/email/capability tests pass.
- Security scan passes.
- RBAC coverage remains 100%.
- Tenant-isolation ratchet passes.
- Release gate passes.
- Desktop and mobile email previews were inspected in the browser.
- The full repository suite exceeded the 20-minute harness limit. Its only observed failure was the policy scanner omitting the new route module; that scanner was updated and the affected test passes.

## Known constraints

- Sending is fail-closed until `OUTREACH_ENABLED=true` and `OUTREACH_REPLY_TO` are configured.
- Current SMTP is reused for a controlled pilot; daily limit defaults to 25.
- Replies and bounces are recorded manually by an operator; there is no inbound-mail parser or provider webhook.
- Opens are deliberately not tracked.
- The logo is a new PNG asset served from the public client build.

## Review questions

1. Are there correctness, security, privacy or deliverability defects that should block merge?
2. Does the implementation match the repository’s architecture and permission model?
3. Are queue idempotency, suppression, campaign state transitions and CSV import safe under failure or concurrency?
4. Is the green/gold email renderer acceptable across major email clients and mobile widths?
5. Are the tests sufficient for the claimed behaviour, and what important cases are missing?
6. Are operator instructions and environment configuration complete and unambiguous?
