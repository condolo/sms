# Firebase setup — Google sign-in, FCM push, Crashlytics

Date: 27 Nov 2026. Firebase project: `msingi-app` (project number `636521063445`).
Console access used: **msingisms@gmail.com** (Msingi ERP) in the Firebase console.

## Done in code

- `server/utils/firebase.js`: works with the installed `firebase-admin` **v14 modular API**.
  `admin.credential.cert()` / `admin.auth()` were removed in v14; now uses
  `admin.cert()`, `admin.applicationDefault()` and `getAuth(app).verifyIdToken()`.
- `server/utils/push.js`: uses `getMessaging(app).sendEachForMulticast()` with a
  legacy fallback (so the mocked jest suite still works).
- Mobile app: `@react-native-firebase/crashlytics@27.1.0` added, lazy initialisation
  in `src/lib/crash.ts` and `App.tsx`, user id/role attached to reports.
- Mobile app: `classesApi.list()` now defaults to `status=active`, so soft-deleted
  classes no longer leak into pickers or report-card filters.

## Credentials generated

A new Admin SDK service-account private key was generated in Firebase Console →
Project settings → Service accounts, using the Msingi Google account.

- Key file (local, secret — never commit):
  `C:\Users\hp\Downloads\msingi-app-firebase-adminsdk-fbsvc-096fc14a7a.json`
- Ready-to-paste base64 for the environment variable:
  `C:\Users\hp\AppData\Local\Temp\opencode\FIREBASE_SERVICE_ACCOUNT_BASE64.txt`

## Required host step (blocked)

`https://msingi.io` currently answers **503 GOOGLE_NOT_CONFIGURED** on
`POST /api/auth/mobile/google`, and push sends are a logged no-op. The host has no
Firebase service account configured.

Set this environment variable on the service that serves `msingi.io`:

```
FIREBASE_SERVICE_ACCOUNT_BASE64=<contents of the base64 file above>
```

(Or `FIREBASE_SERVICE_ACCOUNT=<raw JSON>` / `GOOGLE_APPLICATION_CREDENTIALS=<path>`.)
The Render dashboard was not reachable from any available Google account, so this
could not be applied here. It must be set by someone with access to the deployment.
Then restart/redeploy the service.

## Verification after the env var is set

1. `POST https://msingi.io/api/auth/mobile/google` with header `X-School-Slug: demo`
   and body `{"idToken":"dummy"}` should return **401 GOOGLE_TOKEN_INVALID**,
   not 503 GOOGLE_NOT_CONFIGURED.
2. Sign in on the phone; a token should appear in the `mobile_devices` collection
   and `sendToUsers()` should report `sent > 0` for a real tenant (demo tenants are
   deliberately suppressed).
3. Build a new EAS AAB/APK from the mobile release branch, install it, and trigger
   a test crash — the event should appear in Firebase Console → Crashlytics.

## Data cleanup done live (demo school)

- Student `Gideon Rabala` had free-text `classId: "Year 7"`, which produced an
  `Unknown class` entry in the attendance report. Reassigned to `Form 1A`.
  Verified: attendance report has 10 real classes, no `Unknown class`, roster 31.
- The `__AUDIT_TEST_CLASS_DELETE_ME__` class is inactive with 0 students; the app
  now hides inactive classes, so it no longer appears in any picker.
