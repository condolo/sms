# Medical Centre

## Record a clinic visit

1. Open **Medical** and search/select the correct student.
2. Record the visit date, reason, observations, treatment/action, and follow-up information requested by the form.
3. Save and verify the visit appears on the student's medical history.
4. Use alerts for limited health flags and reports only when authorized; do not use general student notes for clinical information.
5. Correct or delete a visit only through the authorized medical workflow and preserve the reason/audit context where requested.

Medical records are especially sensitive. Share access only with staff who need it for student care, and follow the school's consent and retention policies.


## Setup, updates, and verification

### Maintain confidential health records

Confirm the student identity before recording a visit and enter only information needed for care. Use the medical visit/alert fields intended for the data; avoid general notes or broad shared resources. After saving, verify the visit is attached to the correct student and that access is limited to authorized medical users. Correct records through the medical workflow with the reason where requested; follow school policy for retention and disclosure.

**Access:** Medical view, record, delete, alerts, and report permissions are separate. Alerts may expose less detail than a full clinical record.

**Sources:** `client/src/pages/medical/MedicalPage.jsx`; `server/routes/medical.js`; module permissions in `server/config/moduleRegistry.js`.; [CHANGELOG.md](../../CHANGELOG.md)
