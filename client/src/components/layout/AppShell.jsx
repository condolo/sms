import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from './Sidebar.jsx';
import TopBar  from './TopBar.jsx';
import useAuthStore from '@/store/auth.js';
import { auth as authApi } from '@/api/client.js';
import useIdleTimer from '@/hooks/useIdleTimer.js';
import IdleWarningModal from '@/components/session/IdleWarningModal.jsx';
import { ToastProvider } from '@/hooks/useToast.jsx';
import Toaster from '@/components/ui/Toaster.jsx';
import { setFavicon, DEFAULT_FAVICON, DEFAULT_TITLE } from '@/utils/favicon.js';

const W_EXPANDED  = 256;  // 16rem
const W_COLLAPSED = 64;   // 4rem

export default function AppShell() {
  const { showWarning, warnCountdown, staySignedIn, forceLogout } = useIdleTimer();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const location      = useLocation();
  const school        = useAuthStore(s => s.session?.school);
  const patchUser     = useAuthStore(s => s.patchUser);
  const sessionUser   = useAuthStore(s => s.session?.user);
  const faviconUrl    = school?.faviconUrl ?? null;
  const schoolName    = school?.name ?? null;

  // Refresh role permissions from the server on mount, window focus, and whenever
  // the admin broadcasts a permissions change via BroadcastChannel or custom event.
  const refreshPermissions = useCallback(() => {
    if (!sessionUser) return;
    authApi.permissions()
      .then(res => { patchUser({ permissions: res.permissions ?? undefined }); })
      .catch(() => {}); // silent — stale permissions are acceptable
  }, [sessionUser, patchUser]);

  useEffect(() => {
    refreshPermissions();

    // Re-fetch on window focus (covers tab-switching)
    window.addEventListener('focus', refreshPermissions);

    // Re-fetch when any tab (including this one) signals a permissions change.
    // The Settings R&P tab dispatches 'permissions:changed' after a successful save.
    window.addEventListener('permissions:changed', refreshPermissions);

    // BroadcastChannel syncs across all open tabs on the same origin.
    let bc;
    try {
      bc = new BroadcastChannel('msingi:permissions');
      bc.onmessage = () => refreshPermissions();
    } catch { /* BroadcastChannel not available in all envs */ }

    return () => {
      window.removeEventListener('focus', refreshPermissions);
      window.removeEventListener('permissions:changed', refreshPermissions);
      bc?.close();
    };
  }, [refreshPermissions]);

  // Close mobile overlay on navigation
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  // Apply school favicon + page title dynamically.
  // The <link rel="icon"> element is a single shared DOM node, and SPA route
  // changes don't reload the page — so without a reset on unmount, a school's
  // favicon stays stuck in the tab even after navigating back to the landing
  // page or a different school (this is exactly what happened in production).
  // useLayoutEffect (not useEffect) so this runs before the browser paints —
  // on a hard reload straight into an authenticated page, this is still after
  // the static index.html default has already painted once (unavoidable
  // without SSR), but it closes the *additional* one-frame gap a deferred
  // useEffect would otherwise add on top of that.
  useLayoutEffect(() => {
    setFavicon(faviconUrl || DEFAULT_FAVICON);
    document.title = schoolName || DEFAULT_TITLE;

    return () => {
      setFavicon(DEFAULT_FAVICON);
      document.title = DEFAULT_TITLE;
    };
  }, [faviconUrl, schoolName]);

  function toggleCollapse() {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  }

  return (
    <ToastProvider>
      <div className="flex h-full">
        {showWarning && (
          <IdleWarningModal
            countdown={warnCountdown}
            onStay={staySignedIn}
            onLogout={() => forceLogout('user_choice')}
          />
        )}

        {/* ── Desktop sidebar — spring-animated width ────────────── */}
        <motion.aside
          className="hidden lg:flex lg:flex-col shrink-0 h-full overflow-hidden"
          animate={{ width: collapsed ? W_COLLAPSED : W_EXPANDED }}
          initial={false}
          transition={{ type: 'spring', damping: 28, stiffness: 220, restDelta: 0.5 }}
        >
          <Sidebar collapsed={collapsed} onToggle={toggleCollapse} />
        </motion.aside>

        {/* ── Mobile sidebar — overlay drawer ───────────────────── */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 animate-fade-in-bg"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            {/* Drawer — slides in from the left */}
            <aside className="relative z-50 flex w-64 flex-col animate-drawer-open shadow-xl">
              <Sidebar onClose={() => setSidebarOpen(false)} />
            </aside>
          </div>
        )}

        {/* ── Main content ───────────────────────────────────────── */}
        <div className="flex flex-1 flex-col min-w-0 h-full">
          <TopBar onMenuClick={() => setSidebarOpen(true)} collapsed={collapsed} onExpand={toggleCollapse} />
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>

        {/* Toaster lives inside the flex root so it shares the same stacking context */}
        <Toaster />
      </div>
    </ToastProvider>
  );
}
