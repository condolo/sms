import { useEffect, useRef, useState, useCallback } from 'react';
import useAuthStore from '@/store/auth.js';
import { auth as authApi } from '@/api/client.js';

const IDLE_WARN_MS   = 59 * 60 * 1000;  // warn at 59 min
const IDLE_LOGOUT_MS = 60 * 60 * 1000;  // logout at 60 min
const WARN_COUNTDOWN = 60;               // seconds shown in warning

/* Activity events that reset the idle timer */
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

export default function useIdleTimer() {
  const [showWarning, setShowWarning]       = useState(false);
  const [warnCountdown, setWarnCountdown]   = useState(WARN_COUNTDOWN);

  const lastActivityRef  = useRef(Date.now());
  const warnTimerRef     = useRef(null);
  const logoutTimerRef   = useRef(null);
  const warnCountRef     = useRef(null);
  const isLoggedOutRef   = useRef(false);

  const logout  = useAuthStore(s => s.logout);
  const session = useAuthStore(s => s.session);

  /* ── Force logout ─────────────────────────────────────── */
  const forceLogout = useCallback((reason = 'idle') => {
    if (isLoggedOutRef.current) return;
    isLoggedOutRef.current = true;
    clearTimeout(warnTimerRef.current);
    clearTimeout(logoutTimerRef.current);
    clearInterval(warnCountRef.current);
    setShowWarning(false);
    // Best-effort: tell the server the session ended
    authApi.logout().catch(() => {});
    logout();
  }, [logout]);

  /* ── Reset idle timers on activity ───────────────────── */
  const resetTimers = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (showWarning) return; // don't reset if warning is showing — user must click "Stay"

    clearTimeout(warnTimerRef.current);
    clearTimeout(logoutTimerRef.current);

    warnTimerRef.current   = setTimeout(() => setShowWarning(true),    IDLE_WARN_MS);
    logoutTimerRef.current = setTimeout(() => forceLogout('idle'),     IDLE_LOGOUT_MS);
  }, [showWarning, forceLogout]);

  /* ── "Stay signed in" — ping server then reset timers ── */
  const staySignedIn = useCallback(async () => {
    setShowWarning(false);
    clearInterval(warnCountRef.current);
    setWarnCountdown(WARN_COUNTDOWN);
    lastActivityRef.current = Date.now();

    // Ping validates session status (catches revocations) + updates lastActivity in DB
    const absExpiry = session?.absoluteExpiry;
    if (absExpiry && new Date(absExpiry) < new Date()) {
      forceLogout('absolute');
      return;
    }
    try {
      const res = await authApi.ping();
      // ping returns no token — just check for session-revoked 401
      if (res?.error === 'SESSION_REVOKED' || res?.error === 'SESSION_ABSOLUTE_EXPIRED') {
        forceLogout('revoked');
        return;
      }
    } catch (err) {
      if (err?.status === 401) { forceLogout('revoked'); return; }
      // Other errors: silently ignore — timer already reset
    }

    resetTimers();
  }, [session, forceLogout, resetTimers]);

  /* ── Mount: wire activity listeners and timers ────────── */
  useEffect(() => {
    if (!session?.user) return;
    isLoggedOutRef.current = false;

    resetTimers();

    const handleActivity = () => resetTimers();
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, handleActivity, { passive: true }));

    return () => {
      clearTimeout(warnTimerRef.current);
      clearTimeout(logoutTimerRef.current);
      clearInterval(warnCountRef.current);
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, handleActivity));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);  // re-run only when the user changes (new login)

  /* ── Warning countdown ticker ─────────────────────────── */
  useEffect(() => {
    if (showWarning) {
      setWarnCountdown(WARN_COUNTDOWN);
      warnCountRef.current = setInterval(() => {
        setWarnCountdown(prev => {
          if (prev <= 1) {
            clearInterval(warnCountRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(warnCountRef.current);
    }
    return () => clearInterval(warnCountRef.current);
  }, [showWarning]);

  return { showWarning, warnCountdown, staySignedIn, forceLogout };
}
