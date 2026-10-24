# Msingi — Medical Centre Guide

**Audience:** Authorized school health staff and administrators managing student medical records. This guide covers the current Medical Centre screens and limited student-profile medical fields.

> Medical and consent information is highly sensitive. Access it only when needed for student care. Use the approved school health and safeguarding procedures for urgent situations; Msingi is a recordkeeping tool, not emergency care.

## 1. Access and privacy boundaries

Medical access is split into separate permissions: view clinic visits, record a visit, delete a visit (soft delete), view condition alerts, and view reports. A custom Nurse/Medical role should receive only the capabilities its staff need. The default Teacher role receives **medical alerts only** (limited condition flags); it does not receive full medical profiles, visit histories, or medical reports. Principal/deputy defaults include wider medical access, but school role settings may differ.

Before working with a record, confirm the correct school and student. Never copy clinical details into general Messages, Behaviour, Growth Profile, or shared Resources.

## 2. Review the student medical profile

The student's Medical section is part of the student record and may include blood group, allergies, chronic conditions, disabilities, vaccinations, notes, emergency contact, doctor/clinic details, and parent medical-consent information. Review only for care-related reasons. Profile editing may be controlled by a separate student/profile permission from the Medical Centre visit permissions.

If a clinical fact is wrong, use the authorized student-profile workflow and follow school consent/retention rules. Parent consent fields record who and when changed consent; do not alter them to make an unrelated health edit appear authorized.

## 3. Log a clinic visit

1. Open **Medical Centre → Log Visit**.
2. Search by student name or admission number. Confirm the student's identity before selecting them.
3. Enter the **Complaint**. Add relevant **Observation**, **Action taken**, and **Medication given** details.
4. Mark whether the student **Returned to class**, was **Sent home**, or was **Referred**. If referred, enter where they were referred.
5. Add concise relevant notes; avoid unsupported diagnoses or unrelated information.
6. Review the student and visit details, then choose **Log visit**.
7. Wait for the saved confirmation and check the record under **Visits**.

Each clinic visit is a separate record. The route deliberately has no edit/overwrite operation. If the wrong visit was entered, an authorized user can soft-delete it (the record is marked deleted and excluded from ordinary reads) and create a correct visit with clear documentation. Do not create a replacement until the original is identified.

## 4. Find and review visits

1. Open **Visits** and search by student or complaint.
2. Open the matching visit and check the date, recorded student, complaint, action, medication, referral, and author.
3. Use delete only for a genuine error and only if your role allows it. The delete is soft-delete; it is not a normal history edit.
4. After correction, confirm the incorrect visit is no longer in the ordinary list and that the replacement is present.

## 5. Review medical alerts

1. Open **Alerts** if your role includes this capability.
2. Confirm the student and review the limited alert flags shown (such as severe allergy, asthma, or epilepsy) before using them in care.
3. Treat an alert as a prompt to consult the authorized medical record/person, not a substitute for a full history or care plan.
4. If an alert is outdated or wrong, contact authorized staff to correct the underlying student medical profile.

The Alerts response is intentionally a limited projection and is class-scoped for teachers. It does not expose the full medical profile, clinic visit notes, doctor information, or consent details.

## 6. Use Medical reports

Open **Reports** only if your role has report access. The current reports include visits today/this month, common conditions, and frequent visitors over a selected period. Confirm the date window and use aggregates for school health planning; avoid identifying students in reports shared outside the authorized care group.

## 7. Data quality, confidentiality, and escalation

- Search and verify the student's identity before saving; similar names are not enough.
- Record only what is needed for care, in factual language.
- Do not use general-purpose student notes for clinical information.
- Keep printed reports/screenshots secure and share only with authorized staff or guardians under school policy.
- Follow policy on parent consent, medication handling, retention, and disclosure. Ask the administrator or safeguarding lead when unclear.
- For urgent symptoms, follow the school's emergency response and contact guardians/medical services as required; do not wait for an Msingi record to be created.

## Troubleshooting

| Issue | Check |
|---|---|
| Medical page or tab is missing | Check the specific `medical` view/record/delete/alerts/reports grant and plan/module access. An alerts-only grant cannot open visits or reports. |
| Student cannot be found | Confirm school, active student status, spelling/admission number, and Student module access. |
| Visit does not appear | Check saved confirmation, search terms, page/filter, and whether it was soft-deleted. Avoid duplicate entry until checked. |
| Teacher sees alert but not the profile | This is an intentional least-privilege distinction. A nurse/authorized clinician must review the full profile. |
| Report counts look unexpected | Check the report period/time window and source visit records; report calculations are not a substitute for the visit timeline. |

**Sources checked:** `client/src/pages/medical/MedicalPage.jsx`, student profile Medical section, `server/routes/medical.js`, `server/config/moduleRegistry.js`, `server/utils/repairPermissions.js`, `docs/module-flows/medical.md`, `docs/SCHOOL_ADMIN_GUIDE.md`, and `CHANGELOG.md` through v5.194.0. Key relevant entry: v5.32.0 (profile, immutable visit records with soft delete, limited alerts, reports, consent audit stamps, and teacher alert-only scope). Checked 2026-10-18.
