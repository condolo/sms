import { Navigate, useLocation } from 'react-router-dom';
import useAuthStore from '@/store/auth.js';

/**
 * Wraps children and redirects to /login if the user has no valid session.
 * Students, parents, and group directors have dedicated portals — they are
 * redirected there rather than entering the staff AppShell.
 */
export default function ProtectedRoute({ children }) {
  const session  = useAuthStore(s => s.session);
  const location = useLocation();

  if (!session?.user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const role = session.user?.role;

  // Students belong in their own portal, never the staff shell
  if (role === 'student') {
    return <Navigate to="/student-dashboard" replace />;
  }

  // Parents / guardians belong in the parent portal
  if (role === 'parent' || role === 'guardian') {
    return <Navigate to="/parent-dashboard" replace />;
  }

  // Group directors are read-only, cross-school analytics only — never
  // the staff shell, which is per-school and RBAC would block almost
  // all of anyway (see server/routes/analytics.js's 'group_analytics'
  // permission note).
  if (role === 'group_director') {
    return <Navigate to="/group-dashboard" replace />;
  }

  return children;
}
