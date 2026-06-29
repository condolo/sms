import { useState, useEffect, useCallback } from 'react';
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

  // Refresh role permissions from the server on mount and whenever the window
  // regains focus. This keeps the sidebar in sync with Settings changes made
  // by an admin without requiring users to log out and back in.
  const refreshPermissions = useCallback(() => {
    if (!sessionUser) return;
    authApi.permissions()
      .then(res => { patchUser({ permissions: res.permissions ?? undefined }); })
      .catch(() => {}); // silent — stale permissions are acceptable
  }, [sessionUser, patchUser]);

  useEffect(() => {
    refreshPermissions();
    window.addEventListener('focus', refreshPermissions);
    return () => window.removeEventListener('focus', refreshPermissions);
  }, [refreshPermissions]);

  // Close mobile overlay on navigation
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  // Apply school favicon + page title dynamically
  useEffect(() => {
    // Favicon
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (faviconUrl) {
      link.href = faviconUrl;
    } else {
      link.href = '/favicon.ico';
    }

    // Page title
    if (schoolName) {
      document.title = schoolName;
    }
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
