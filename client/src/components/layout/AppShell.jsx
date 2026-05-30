import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from './Sidebar.jsx';
import TopBar  from './TopBar.jsx';

const W_EXPANDED  = 256;  // 16rem
const W_COLLAPSED = 64;   // 4rem

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const location = useLocation();

  // Close mobile overlay on navigation
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  function toggleCollapse() {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  }

  return (
    <div className="flex h-full">

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

    </div>
  );
}
