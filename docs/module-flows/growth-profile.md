# Growth Profile

## Add and verify a student record

1. Open a student's **Growth Profile** and choose the relevant section: leadership, activities, service, awards, projects, recommendations, or aspirations.
2. Add dates, descriptions, evidence, and other required details. Confirm the record belongs to the correct student and academic period.
3. Save and review its verification status. Authorized staff verify records where the workflow requires it.
4. Edit or delete records using the section's own action and permission. Recommendations and aspirations may have separate visibility/authorization behavior.

Use this module for development/co-curricular evidence, not as a substitute for grades, attendance, or behaviour records.


## Setup, updates, and verification

### Maintain growth records

Confirm the correct student and academic period before adding an activity, award, project, recommendation, or aspiration. Attach evidence only through the intended field and keep it relevant to the record. Use the record's own edit/delete or verification action; check the resulting verification state and student/parent visibility. If the entry is wrong, correct the source record rather than expecting a summary to change independently.

**Access:** Growth Profile permissions distinguish viewing, adding, editing, deleting, projects, recommendations, aspirations, and verification. Student and staff views may be scoped differently.

**Sources:** `client/src/pages/growth-profile/`; `server/routes/growth-profile.js`, `growth-records.js`, `growth-projects.js`, `growth-recommendations.js`.; [CHANGELOG.md](../../CHANGELOG.md)
