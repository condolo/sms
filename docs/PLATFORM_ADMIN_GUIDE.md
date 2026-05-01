# InnoLearn — Platform Administrator Guide

> **Audience:** The InnoLearn platform owner and operator. This guide covers everything needed to run the InnoLearn SaaS platform — provisioning schools, managing subscriptions, monitoring the system, and deploying updates.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Architecture](#2-architecture)
3. [Environment Setup](#3-environment-setup)
4. [Deploying & Updating](#4-deploying--updating)
5. [Provisioning a New School](#5-provisioning-a-new-school)
6. [Managing Schools & Plans](#6-managing-schools--plans)
7. [Platform Admin API Reference](#7-platform-admin-api-reference)
8. [Revenue & MRR Monitoring](#8-revenue--mrr-monitoring)
9. [Impersonating a School Admin](#9-impersonating-a-school-admin)
10. [Security](#10-security)
11. [Backup & Recovery](#11-backup--recovery)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Platform Overview

InnoLearn is a **multi-tenant SaaS** school management platform. Each school is an isolated tenant identified by a unique `schoolId`. All API calls are scoped to the authenticated school — no school can ever access another school's data.

### Key roles at the platform level

| Role | Who | What they can do |
|---|---|---|
| **Platform Owner** | You | Full access to all API routes, can provision/suspend/impersonate any school |
| **School Super Admin** | School's IT admin | Full access within their own school only |
| **School Admin** | Principal/HM | Full school access (same as super admin within the school) |
| All other roles | Staff, parents, students | Scoped access per role_permissions table |

---

## 2. Architecture

```
InnoLearn.com / app.InnoLearn.com
        │
        ▼
  Render Web Service
  ┌─────────────────────────────────┐
  │  Node.js + Express (server/)    │
  │  ├── /api/auth          JWT auth│
  │  ├── /api/onboard       signup  │
  │  ├── /api/sync          data    │
  │  ├── /api/collections   CRUD    │
  │  └── /api/platform      admin   │
  │  Static: index.html, onboard.html │
  └─────────────────────────────────┘
        │
        ▼
  MongoDB Atlas (cloud)
  Collections: schools, users, students, teachers,
               classes, subjects, timetable, attendance,
               academics, exams, finance, hr, behaviour,
               communication, events, admissions, reports,
               role_permissions, academic_years, sections...
```

**Data flow:** The browser uses `localStorage` as a synchronous cache. On login, `GET /api/sync` populates localStorage. All writes mirror to MongoDB async via `_push()`. On next login, fresh data is loaded from the server.

---

## 3. Environment Setup

### Required environment variables

| Variable | Description | Example |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string | `mongodb+srv://user:pass@cluster.mongodb.net/InnoLearn` |
| `JWT_SECRET` | Secret for signing JWTs — **must be long and random** | `openssl rand -hex 64` |
| `JWT_EXPIRES_IN` | Token lifetime | `7d` |
| `PLATFORM_ADMIN_KEY` | Secret key for platform API — keep private | `openssl rand -hex 32` |
| `PORT` | Server port (Render sets this automatically) | `3005` |
| `NODE_ENV` | `production` on Render, `development` locally | `production` |
| `APP_URL` | Base URL of the app | `https://innolearn-ecosystem.onrender.com` |

### Setting on Render

1. Go to your Render dashboard → **innolearn-ecosystem** service
2. Click **Environment** tab
3. Add each variable above
4. Click **Save Changes** — Render will redeploy automatically

### Local development

```bash
cp .env.example .env
# Edit .env with your values
node server/index.js
# or: npm run dev (if nodemon installed)
```

---

## 4. Deploying & Updating

InnoLearn is deployed via GitHub → Render (auto-deploy on push to `main`).

### Normal update flow

```bash
# Make your changes
git add -A
git commit -m "feat: describe what changed"
git push origin main
# Render auto-deploys within ~60 seconds
```

### Verify deployment

```
GET https://innolearn-ecosystem.onrender.com/api/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "3.1.0",
  "db": "connected"
}
```

If `"db": "disconnected"` — check `MONGODB_URI` in Render environment.

---

## 5. Provisioning a New School

Schools can self-register via `onboard.html`. You can also provision manually via the platform API (useful for enterprise clients or bulk setup).

### Via the onboarding page

Direct the school to: `https://innolearn-ecosystem.onrender.com/onboard`

They fill the 4-step wizard → school + admin user is created automatically → 30-day free trial starts.

### Via Platform API (manual)

```bash
curl -X POST https://innolearn-ecosystem.onrender.com/api/platform/schools \
  -H "Content-Type: application/json" \
  -H "X-Platform-Key: YOUR_PLATFORM_ADMIN_KEY" \
  -d '{
    "name": "Sunrise Academy",
    "shortName": "SA",
    "slug": "sunrise",
    "plan": "standard",
    "adminName": "James Mwangi",
    "adminEmail": "james@sunriseacademy.ke",
    "adminPassword": "SecurePass@2026",
    "currency": "KES",
    "timezone": "Africa/Nairobi"
  }'
```

Response:
```json
{
  "school": { "id": "sch_sunrise_...", "slug": "sunrise", "plan": "standard", ... },
  "adminUserId": "u_sunrise_admin"
}
```

---

## 6. Managing Schools & Plans

### List all schools

```bash
curl https://innolearn-ecosystem.onrender.com/api/platform/schools \
  -H "X-Platform-Key: YOUR_PLATFORM_ADMIN_KEY"
```

Returns all schools with student/staff counts and plan info.

### Upgrade / change a school's plan

```bash
curl -X PATCH https://innolearn-ecosystem.onrender.com/api/platform/schools/SCH_ID \
  -H "Content-Type: application/json" \
  -H "X-Platform-Key: YOUR_PLATFORM_ADMIN_KEY" \
  -d '{ "plan": "premium" }'
```

### Suspend a school

```bash
curl -X PATCH https://innolearn-ecosystem.onrender.com/api/platform/schools/SCH_ID \
  -H "Content-Type: application/json" \
  -H "X-Platform-Key: YOUR_PLATFORM_ADMIN_KEY" \
  -d '{ "isActive": false }'
```

### Reinstate a school

```bash
curl -X PATCH .../api/platform/schools/SCH_ID \
  -H "X-Platform-Key: YOUR_PLATFORM_ADMIN_KEY" \
  -d '{ "isActive": true }'
```

### Set trial expiry

```bash
curl -X PATCH .../api/platform/schools/SCH_ID \
  -H "X-Platform-Key: YOUR_PLATFORM_ADMIN_KEY" \
  -d '{ "planExpiry": "2026-06-30T00:00:00.000Z" }'
```

---

## 7. Platform Admin API Reference

All platform routes require the header:
```
X-Platform-Key: YOUR_PLATFORM_ADMIN_KEY
```

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/platform/schools` | List all schools with stats |
| `POST` | `/api/platform/schools` | Provision a new school manually |
| `PATCH` | `/api/platform/schools/:id` | Update plan, addOns, isActive, planExpiry |
| `POST` | `/api/platform/schools/:id/impersonate` | Get a JWT for any school's superadmin |
| `GET` | `/api/platform/stats` | MRR, school counts, plan breakdown |

---

## 8. Revenue & MRR Monitoring

```bash
curl https://innolearn-ecosystem.onrender.com/api/platform/stats \
  -H "X-Platform-Key: YOUR_PLATFORM_ADMIN_KEY"
```

Response:
```json
{
  "totalSchools": 12,
  "activeSchools": 10,
  "totalStudents": 4320,
  "mrr": 525000,
  "byPlan": {
    "core": 2,
    "standard": 6,
    "premium": 3,
    "enterprise": 1
  }
}
```

MRR is calculated as: `core × 15,000 + standard × 35,000 + premium × 65,000 + enterprise × 250,000` (KES).

---

## 9. Impersonating a School Admin

Use this to troubleshoot a school's issue without needing their password.

```bash
curl -X POST https://.../api/platform/schools/SCH_ID/impersonate \
  -H "X-Platform-Key: YOUR_PLATFORM_ADMIN_KEY"
```

Response:
```json
{ "token": "eyJhbGci...", "user": { "name": "James Mwangi", ... } }
```

Use the token as a Bearer token in any API call, or set it in the browser console:
```javascript
localStorage.setItem('ss_jwt', 'eyJhbGci...');
location.reload();
```

> ⚠️ **Audit trail:** Log impersonation sessions. Schools must be informed in your Terms of Service that platform admin access exists for support purposes.

---

## 10. Security

### Current protections

| Layer | Mechanism |
|---|---|
| **JWT auth** | All API routes require a valid JWT (RS/HS256) |
| **School isolation** | Every query auto-filtered by `schoolId` from JWT |
| **Platform key** | Admin API protected by separate secret header |
| **Rate limiting** | Login: 20/15min per IP; Onboarding: 5/hour per IP |
| **Honeypot** | Hidden form field on registration — bots fill it, humans don't |
| **Timing check** | Registration rejected if form submitted in < 4 seconds |
| **Disposable emails** | 25+ known disposable domains blocked at registration |
| **bcrypt** | Passwords hashed at 12 rounds |
| **CORS** | Configurable — tighten origin list for production |

### Deferred (planned)

- **2FA (TOTP)** — authenticator app support for Super Admin accounts
- **reCAPTCHA v3** — invisible challenge on the onboarding form
- **Email OTP verification** — verify email before provisioning (requires SMTP setup)
- **Audit log** — every admin action recorded with timestamp + IP

### Hardening checklist for production

- [ ] `PLATFORM_ADMIN_KEY` is at least 32 random bytes
- [ ] `JWT_SECRET` is at least 64 random bytes
- [ ] `NODE_ENV=production` is set on Render
- [ ] MongoDB Atlas network access restricted to Render IP
- [ ] CORS origin list tightened to your domain(s)
- [ ] HTTPS enforced (automatic on Render)

---

## 11. Backup & Recovery

### MongoDB Atlas automated backups

1. Go to MongoDB Atlas → your cluster → **Backup**
2. Enable **Continuous Cloud Backup** (recommended)
3. Set a retention period (7 days minimum)

### Manual export

```bash
mongodump --uri="$MONGODB_URI" --out=./backup/$(date +%Y%m%d)
```

### Restore

```bash
mongorestore --uri="$MONGODB_URI" ./backup/20260430/
```

### localStorage data migration

Use the sync endpoint to push a school's localStorage data to MongoDB:
```bash
POST /api/sync
Authorization: Bearer SCHOOL_JWT
Content-Type: application/json
Body: { full localStorage payload }
```

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/api/health` returns `"db": "disconnected"` | `MONGODB_URI` not set or wrong | Check Render Environment tab |
| JWT errors on login | `JWT_SECRET` mismatch after env change | Have users log out and back in |
| Platform API returns 403 | Wrong `PLATFORM_ADMIN_KEY` | Check the key in Render env |
| Onboarding returns 429 | Rate limit hit (5/hour) | Wait or change IP for testing |
| School data missing after reseed | `SEED_VERSION` bump wiped localStorage | Expected — re-login populates from server |
| Render deploy fails | `npm install` error | Check `package.json` for missing deps |

---

*Last updated: 2026-04-30 — InnoLearn v3.1.0*
