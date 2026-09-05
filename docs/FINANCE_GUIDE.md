# Msingi — Finance Officer Guide

> **Audience:** Staff assigned the **Finance** role. Covers fee structures, invoicing, recording payments, M-Pesa integration, and the Overdue/Summary views. Every plan includes the full Finance module — access here is a role permission, not a subscription tier (see the School Administrator Guide, §9).

---

## Table of Contents

1. [What You Can Access](#1-what-you-can-access)
2. [Fee Structures](#2-fee-structures)
3. [Invoices](#3-invoices)
4. [Recording Payments](#4-recording-payments)
5. [M-Pesa Integration](#5-m-pesa-integration)
6. [Overdue Accounts](#6-overdue-accounts)
7. [Summary Dashboard](#7-summary-dashboard)
8. [Exporting Finance Data](#8-exporting-finance-data)

---

## 1. What You Can Access

The **Finance** role has full access (view, create, update, delete) to the **Finance** module, plus view-only access to Students, Report Cards, Events, Library, Hostel, and Transport, and messaging access for parent/staff communication. You do not have access to Grades, Exams, HR, Attendance, or Behaviour by default — ask your School Admin (Settings → Roles & Permissions) if your school has customised this.

The Finance module has five tabs: **Summary, Invoices, Overdue, Payments, Fee Structure.**

---

## 2. Fee Structures

Go to **Finance → Fee Structure**.

A fee structure is a reusable template — a term's tuition, a trip fee, a uniform charge — that you generate invoices *from*, rather than typing the same amount onto every student one at a time.

1. Click **Add Fee Structure**
2. Name it clearly (e.g. `Term 2 2025 — Full Fee`) and add a description
3. Add one or more **line items** (e.g. `Tuition Fee` — amount)
4. Choose who it applies to:
   - **All active students**
   - **Specific classes**
   - **Specific sections**
   - **Specific students**
5. Save

### Generating invoices from a structure

Once a fee structure is saved, click **Generate Invoices**. This bulk-creates one invoice per matching active student — students who **already have an invoice from that same structure are skipped automatically**, so it's safe to re-run after adding new students mid-term without creating duplicates.

---

## 3. Invoices

Go to **Finance → Invoices**.

Each invoice shows its status: **unpaid**, **partial**, **paid**, or **void**. Status is computed automatically from `amountPaid` vs. the invoice total — you never set it directly.

### Voiding an invoice

Available on any invoice that is **not already paid or void**. Click the void icon → confirm. **This cannot be undone** — use it for a genuine billing error (wrong student, duplicate, wrong amount), not as a way to "cancel" a payment plan. A voided invoice keeps its full history but stops counting toward totals or appearing as overdue.

---

## 4. Recording Payments

Go to **Finance → Payments → Record Payment**, or from a specific invoice.

Fields: student/invoice, **Amount**, **Payment Method** (Cash, M-Pesa, Bank Transfer, Cheque, Card, Other), **Payment Date**, and optional notes. Save — the invoice's `amountPaid` and status update immediately, and a receipt is available from the Payments list.

> **M-Pesa payments made via STK Push or paybill are reconciled automatically** (see §5) and appear here without manual entry — only record a payment by hand for cash, bank transfer, cheque, or a manual M-Pesa entry that wasn't auto-matched.

---

## 5. M-Pesa Integration

Configured once by a School Admin at **Settings → School Profile → M-Pesa Integration** (Daraja API). If you need this set up or changed, that's who to ask — Finance staff use it day-to-day but the credentials themselves are an admin-level setting.

What it enables: **STK Push** payments (parent enters their M-Pesa PIN on their phone to pay directly) and **automatic C2B reconciliation** (a parent paying your paybill/till number directly is matched to the right invoice without anyone typing it in).

Fields an admin configures: Consumer Key, Consumer Secret, Paybill/Till Number, STK Push Passkey, Environment (Sandbox for testing / Production for live), and a Public Callback Base URL. Credentials are stored encrypted per school. Safaricom's callback URL for C2B registration is `/api/mpesa/callback`.

---

## 6. Overdue Accounts

Go to **Finance → Overdue** for a live list of every unpaid or partially-paid invoice past its due date, sorted so the most overdue balances surface first. Use this for fee-collection follow-up calls or reminder messages, rather than filtering the full Invoices list by hand.

---

## 7. Summary Dashboard

Go to **Finance → Summary** for the headline numbers: total invoiced, total collected, total outstanding, and the collection rate for the current period — the same figures that feed the platform Dashboard's Fee Collection card.

---

## 8. Exporting Finance Data

Each list (Invoices, Payments) has an **Export** button that downloads a CSV. Exports respect whatever filters are currently applied on screen — filter to a class or date range first, and the export matches exactly what you see.

---

*Last reviewed: 2026-09-05 — checked directly against `client/src/pages/finance/` and `server/routes/finance.js`.*
