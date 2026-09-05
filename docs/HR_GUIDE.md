# Msingi — HR Guide

> **Audience:** Staff assigned the **HR** role. Covers staff records, leave requests and approval, payroll, and staff documents. Every plan includes the full HR module — access here is a role permission, not a subscription tier (see the School Administrator Guide, §9).

---

## Table of Contents

1. [What You Can Access](#1-what-you-can-access)
2. [Staff Records](#2-staff-records)
3. [Leave](#3-leave)
4. [Payroll](#4-payroll)
5. [Documents](#5-documents)
6. [Everyone's Own Self-Service View](#6-everyones-own-self-service-view)

---

## 1. What You Can Access

The **HR** role has full access (view, create, update, delete) to **Teachers/Staff** records, plus **read/update** and workflow-configuration access to the **HR** module itself (leave chains, approval routing). You also have view-only access to Students, Events, Library, Hostel, and Transport, and messaging for staff communication.

The HR module has four tabs: **Staff, Leave, Payroll, Documents.**

---

## 2. Staff Records

Go to **HR → Staff**. This is the same staff roster as Settings → Users, scoped to the HR module's own view.

- **Inviting a new staff member**, **setting a password**, and **assigning roles** are covered in the School Administrator Guide (§6) — those actions live under Settings → Users, not here.
- HR-managed fields — department, contract type, employment status, national ID, NSSF/SHA/KRA numbers — are edited from a staff member's HR record and are **not** visible on their own self-edit Profile page. That's deliberate: a staff member can update their own address or next-of-kin, but only HR changes their employment data.
- **Staff Type vs. Roles & Responsibilities:** Staff Type (Teacher, Administrator, Librarian, etc.) is a single HR/payroll category per person. Roles & Responsibilities (Head of Department, Class Teacher, Timetabler, Exam Officer, Deputy, Principal, or any custom role your school has added) are functional duties — one person can hold several.

---

## 3. Leave

Go to **HR → Leave**. Pending requests are counted in the tab label so you can see at a glance how many are waiting on you.

Leave types: **Annual, Sick, Emergency, Maternity, Paternity, Unpaid.**

### Approving a leave request

If your school has configured a **leave approval chain** (multi-step sign-off — e.g. Head of Department, then Deputy Principal, then HR), a request shows **Confirm** at each step until it reaches you as the final approver, where it shows **Approve**. If there's no chain configured, every pending request shows **Approve** directly. Reject any request with a reason at any step.

### Configuring the approval chain

HR (and only HR/admin — this needs the `manage_workflow` permission) can set up the leave approval chain itself: which roles sign off, and in what order, before a request reaches HR for final approval. Configure this from the Leave tab's workflow settings.

---

## 4. Payroll

Go to **HR → Payroll**. Select the **Pay Period** (month) at the top — every action below is scoped to that period.

### Starting a new period

Click **Copy from [previous month]** to duplicate last period's salary data (basic salary, allowance/deduction items) as a starting point for every staff member who already had a record — much faster than re-entering everything by hand each month. The result tells you how many records were copied.

### Adding or editing a pay record

Click **Add Entry** (or edit an existing one). Enter:
- **Basic Salary**
- **Allowances** — itemized, using the allowance types your school has configured (see Payroll Settings below)
- **Deductions** — itemized the same way
- **Apply statutory deductions (PAYE/NSSF/SHIF/Housing Levy)** — toggle this on to have Kenyan statutory deductions computed automatically from gross pay when you save. The net pay shown before saving does **not** include statutory deductions yet — the actual net pay is lower once they're applied.

### Payroll Settings

Click **Payroll Settings** to define the allowance and deduction *types* available in the itemized rows above (e.g. "Transport Allowance", "House Allowance", "Loan Deduction") — configure these once, then reuse them every period.

### Payslips

Staff download their own payslip as a PDF from their self-service Payslip tab (§6) once you've saved their record for that period. You can also export the whole period's payroll as CSV from the Payroll tab's export button.

---

## 5. Documents

Go to **HR → Documents**. Upload per-staff files under one of four types: **Contract, Appraisal, Certificate, ID/Document,** or **Other**. Use this instead of emailing documents around — everything stays attached to the staff member's own record.

---

## 6. Everyone's Own Self-Service View

Every staff member — not just HR — has their own **My Leaves** and **My Payslip** tabs on this same page, scoped automatically to themselves: submitting their own leave requests and tracking status, and downloading their own payslip once HR has posted it for the period. They cannot see anyone else's records here.

---

*Last reviewed: 2026-09-05 — checked directly against `client/src/pages/hr/HRPage.jsx` and `server/routes/hr.js`.*
