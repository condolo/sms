import { create } from 'zustand';

const SESSION_KEY = 'msingi_session';

/**
 * What we persist to localStorage:
 *   (token is NEVER persisted — it lives in an HttpOnly cookie, inaccessible to JS)
 *   user (slim)  — id, name, role, schoolId, studentId, guardianOf, permissions
 *                  NO email (PII) — stays in memory only
 *   school (slim)— id, name, slug, plan, logoUrl, faviconUrl, moduleConfig, primaryColor
 *                  NO tagline, address, mpesa keys, etc.
 *
 * permissions IS persisted (not PII — just module access flags) so the
 * sidebar stays correctly filtered after a page refresh without a re-fetch.
 * XSS can still steal the token, but cannot read email from storage.
 */
function _slimUser(user) {
  if (!user) return null;
  return {
    id:          user.id,
    name:        user.name,
    role:        user.role,
    roles:       user.roles,
    primaryRole: user.primaryRole,
    schoolId:    user.schoolId,
    studentId:   user.studentId   ?? undefined,
    guardianOf:  user.guardianOf  ?? undefined,
    studentIds:  user.studentIds  ?? undefined,
    photoUrl:    user.photoUrl    ?? undefined,
    permissions: user.permissions ?? undefined,
  };
}

function _slimSchool(school) {
  if (!school) return null;
  return {
    id:           school.id,
    name:         school.name,
    shortName:    school.shortName,
    slug:         school.slug,
    plan:         school.plan,
    logoUrl:      school.logoUrl     ?? undefined,
    faviconUrl:   school.faviconUrl  ?? undefined,
    primaryColor: school.primaryColor ?? undefined,
    accentColor:  school.accentColor  ?? undefined,
    moduleConfig: school.moduleConfig ?? undefined,
    modulePermissions: school.modulePermissions ?? undefined,
    isActive:     school.isActive,
    // Persisted so academic year labels survive a page refresh.
    // Updated via patchSchool() after a year transition in Settings.
    academicYear:          school.academicYear          ?? undefined,
    // Persisted so timetable can read emergency mode on page refresh.
    emergencyOnlineMode:   school.emergencyOnlineMode   ?? undefined,
  };
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  // token is NOT persisted — it lives in an HttpOnly cookie (inaccessible to JS/XSS)
  const slim = {
    user:            _slimUser(session.user),
    school:          _slimSchool(session.school),
    absoluteExpiry:  session.absoluteExpiry ?? undefined,
    // availableSchools (just {id,name} pairs — no PII) — switching schools
    // (TopBar.jsx's handleSwitchSchool) deliberately hard-reloads the page
    // to discard school-scoped cache/component state, which wipes anything
    // not persisted here. Without this, the School Switcher worked exactly
    // once per login (only while the in-memory session from that /login
    // response was still alive) and silently vanished the moment it was
    // actually used, on both schools, every time.
    availableSchools: session.availableSchools ?? undefined,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(slim));
}

const useAuthStore = create((set, get) => ({
  // ─── State ──────────────────────────────────────────────────────────────────
  session:      loadSession(),
  isLoading:    false,
  error:        null,

  // ─── Derived getters ────────────────────────────────────────────────────────
  get isAuthenticated() { return !!get().session?.user; },
  get user()            { return get().session?.user ?? null; },
  get token()           { return null; }, // token lives in HttpOnly cookie — not accessible to JS
  get schoolId()        { return get().session?.user?.schoolId ?? null; },
  get role()            { return get().session?.user?.role ?? null; },
  get plan()            { return get().session?.school?.plan ?? get().session?.user?.plan ?? 'core'; },
  // C9 (D-004) — other schools this user can switch to. Set only by a
  // login/exchange response that included it (never persisted, so it's
  // absent again until the next such response — acceptable since a page
  // refresh doesn't call login again either).
  get availableSchools(){ return get().session?.availableSchools ?? []; },

  // ─── Actions ────────────────────────────────────────────────────────────────

  /**
   * Call after successful /api/auth/login response.
   * Full session object (with email, permissions etc.) lives in memory.
   * Only slim version is persisted to localStorage.
   * @param {{ token: string, user: object, school: object }} session
   */
  setSession(session) {
    saveSession(session);          // persists slim version
    set({ session, error: null }); // keeps full object in memory
  },

  /** Clear session and redirect to /login */
  logout() {
    saveSession(null);
    set({ session: null, error: null });
  },

  /** Update user profile fields in the stored session (e.g. after settings save) */
  patchUser(updates) {
    const { session } = get();
    if (!session) return;
    const next = { ...session, user: { ...session.user, ...updates } };
    saveSession(next);
    set({ session: next });
  },

  /** Update school fields in the stored session (e.g. after module config save) */
  patchSchool(updates) {
    const { session } = get();
    if (!session) return;
    const next = { ...session, school: { ...session.school, ...updates } };
    saveSession(next);
    set({ session: next });
  },

  setLoading(isLoading) { set({ isLoading }); },
  setError(error)       { set({ error }); },
  clearError()          { set({ error: null }); },

  /** Permission check helper — true if role is admin/superadmin or has ≥1 action for feature */
  can(feature) {
    const { session } = get();
    if (!session) return false;
    const { role, permissions = {} } = session.user ?? {};
    if (role === 'superadmin') return true;
    // null permissions means full access (superadmin path above handles this,
    // but guard here too in case permissions arrives as null from the server)
    if (permissions === null) return true;
    const p = permissions[feature];
    // permissions[feature] is always an array (from _deriveApiPerms).
    // Empty array [] means no access — !![] is incorrectly truthy, so check length explicitly.
    if (Array.isArray(p)) return p.length > 0;
    return !!p;
  },
}));

// ─── Listen for server-side 401 broadcasts ────────────────────────────────────
window.addEventListener('api:unauthorized', () => {
  useAuthStore.getState().logout();
});

export default useAuthStore;
