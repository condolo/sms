# HR & Payroll

Use the detailed [HR Guide](../HR_GUIDE.md) for staff records, leave approvals, payroll periods, documents, and staff self-service.

1. Create/maintain a staff HR record under **HR → Staff**. A staff record and a login account are separate; use the linked create-login flow if the employee needs system access.
2. If someone already has a login but no HR record (common for a school's very first account, or anyone promoted to superadmin before HR existed for them), use **Activate Existing User** instead of Add Staff — pick them from the list and it pre-fills their name/email with the email locked, so the new HR record links back to their existing login instead of creating a duplicate, disconnected one.
3. Staff submit leave through their own self-service view. Authorized approvers review the request, follow the configured approval chain, and record the outcome.
4. For payroll, select the pay period, create/copy entries, verify salary components and statutory deductions, then save and review totals.
5. Upload staff documents to the correct staff record and document type.
6. Staff use **My Leaves** and **My Payslip** for their own information; use these dedicated views instead of generic collection access.


## Setup, updates, and verification

### Maintain staff, leave, and payroll setup

Create the HR staff record before inviting a login; then verify that the user account is linked to the correct employee. If the person already has a login (added before HR existed for them, or through Settings' own Invite), use Activate Existing User rather than re-typing them into Add Staff — retyping risks a second, disconnected record instead of one properly linked back to their real login. Set up leave/payroll approval workflows and pay components before processing requests or a pay period. Review the approval chain, staff scope, period, deductions, and totals before finalizing payroll. Corrections should use the HR/payroll adjustment flow and preserve the reason. Use the dedicated self-service screens for an employee's own leave and payslip.

**Access:** HR permissions distinguish staff, leave, payroll, documents, export, and workflow administration. Personal self-service is scoped to the caller.

**Sources:** `client/src/pages/hr/`; `server/routes/hr.js`, `settings.js`, `teachers.js`; [HR Guide](../HR_GUIDE.md).

**Recent change notes:** see [CHANGELOG.md](../../CHANGELOG.md), especially v5.110.0 for grantable leave/payroll workflow configuration, and v5.144.0 for Activate Existing User and the staff Add Staff dropdown now matching Settings' role list (Principal was missing before); see also the [HR architectural review](../audits/HR_PAYROLL_ARCHITECTURAL_REVIEW.md).
