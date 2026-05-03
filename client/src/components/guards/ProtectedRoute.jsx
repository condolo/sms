import { Navigate, useLocation } from 'react-router-dom';
import useAuthStore from '@/store/auth.js';

/**
 * Wraps children and redirects to /login if the user has no valid session.
 * After login, the server's /api/auth/login response sets the session.
 */
export default function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => !!s.session?.token);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
