# Admissions

Follow the detailed [Admissions Guide](../ADMISSIONS_GUIDE.md) for required fields, guardian details, pipeline stages, and enrollment.

1. Open Admissions and use Board to move between stages or List to search/filter.
2. Add an application and complete the fields required by the school's admission settings.
3. Record stage changes and notes as the application progresses; use rejected/withdrawn outcomes to close without deleting its history.
4. At Acceptance, open the application and use **Enroll Student**. Review the student details and any draft admission invoice created by the school's fee setup.
5. Use bulk student import for a school migration rather than creating applicants that were not processed through the admissions pipeline.


## Setup, updates, and verification

### Set up intake and revise requirements

Before accepting live applications, have an administrator review the school's Admission Requirements and any admission-linked fee structure. Check which identity and guardian fields are mandatory. When requirements change, tell the admissions team; older applications may need missing required details completed before enrollment. Use the application's edit and stage-history controls to correct records while retaining the applicant trail. Verify enrollment by opening the linked student in Students; verify any generated invoice in Finance as a draft before issuing it.

**Access:** Admissions permissions control the pipeline. Enrolling also requires student-create authority. An enrolled application linked to a student may disappear from the default active board while remaining stored.

**Sources:** `client/src/pages/admissions/`; `server/routes/admissions.js`; [School Administrator Guide](../SCHOOL_ADMIN_GUIDE.md#7-student-enrollment).

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.59.0 and v5.82.0–v5.86.0 for school-specific requirements and the enrollment lifecycle.
