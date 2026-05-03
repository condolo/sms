import { create } from 'zustand';

const SESSION_KEY = 'innolearn_session';

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else         localStorage.removeItem(SESSION_KEY);
}

const useAuthStore = create((set, get) => ({
  // ─── State ──────────────────────────────────────────────────────────────────
  session:      loadSession(),
  isLoading:    false,
  error:        null,

  // ─── Derived getters ────────────────────────────────────────────────────────
  get isAuthenticated() { return !!get().session?.token; },
  get user()            { return get().session?.user ?? null; },
  get token()           { return get().session?.token ?? null; },
  get schoolId()        { return get().session?.user?.schoolId ?? null; },
  get role()            { return get().session?.user?.role ?? null; },
  get plan()            { return get().session?.user?.plan ?? 'core'; },

  // ─── Actions ────────────────────────────────────────────────────────────────

  /**
   * Call after successful /api/auth/login response.
   * @param {{ token: string, user: object }} session
   */
  setSession(session) {
    saveSession(session);
    set({ session, error: null });
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

  setLoading(isLoading) { set({ isLoading }); },
  setError(error)       { set({ error }); },
  clearError()          { set({ error: null }); },

  /** Permission check helper — true if role is admin/superadmin or has feature */
  can(feature) {
    const { session } = get();
    if (!session) return false;
    const { role, permissions = {} } = session.user ?? {};
    if (role === 'superadmin' || role === 'admin') return true;
    return !!permissions[feature];
  },
}));

// ─── Listen for server-side 401 broadcasts ────────────────────────────────────
window.addEventListener('api:unauthorized', () => {
  useAuthStore.getState().logout();
});

export default useAuthStore;
