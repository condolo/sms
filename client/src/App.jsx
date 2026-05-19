import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';

import AppShell from '@/components/layout/AppShell.jsx';
import ProtectedRoute from '@/components/guards/ProtectedRoute.jsx';
import { Spinner } from '@/components/ui/Spinner.jsx';
import { detectSchool } from '@/utils/schoolDetect.js';

// ─── Eager pages ──────────────────────────────────────────────────────────────
import Login   from '@/pages/Login.jsx';
import Landing from '@/pages/Landing.jsx';

// ─── Lazy pages ───────────────────────────────────────────────────────────────
const Dashboard      = lazy(() => import('@/pages/Dashboard.jsx'));
const StudentList    = lazy(() => import('@/pages/students/StudentList.jsx'));
const StudentProfile = lazy(() => import('@/pages/students/StudentProfile.jsx'));
const TeacherList    = lazy(() => import('@/pages/teachers/TeacherList.jsx'));
const ClassList      = lazy(() => import('@/pages/classes/ClassList.jsx'));
const AttendancePage = lazy(() => import('@/pages/attendance/AttendancePage.jsx'));
const FinancePage    = lazy(() => import('@/pages/finance/FinancePage.jsx'));
const BehaviourPage  = lazy(() => import('@/pages/behaviour/BehaviourPage.jsx'));
const ExamsPage      = lazy(() => import('@/pages/exams/ExamsPage.jsx'));
const AdmissionsPage = lazy(() => import('@/pages/admissions/AdmissionsPage.jsx'));
const TimetablePage  = lazy(() => import('@/pages/timetable/TimetablePage.jsx'));
const SettingsPage      = lazy(() => import('@/pages/settings/SettingsPage.jsx'));
const GradesPage        = lazy(() => import('@/pages/grades/GradesPage.jsx'));
const ImportExportPage  = lazy(() => import('@/pages/import-export/ImportExportPage.jsx'));
const NotFound          = lazy(() => import('@/pages/NotFound.jsx'));

function SuspenseWrapper({ children }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner size="lg" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

// ─── Determine entry point ────────────────────────────────────────────────────
// If we're on the main domain (no school slug detected) → show Landing page.
// If we're on a school subdomain / ?school= param → show Login (school-branded).
const { isSchool } = detectSchool();

export const router = createBrowserRouter([
  // Root — landing page on main domain, login redirect on school domain
  {
    path: '/',
    element: isSchool
      ? <Navigate to="/login" replace />
      : <Landing />,
  },

  // Login — branded when on school subdomain, generic otherwise
  { path: '/login', element: <Login /> },

  // Protected shell — only reachable after authentication
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { path: 'dashboard',             element: <SuspenseWrapper><Dashboard /></SuspenseWrapper> },

      // Students
      { path: 'students',              element: <SuspenseWrapper><StudentList /></SuspenseWrapper> },
      { path: 'students/:studentId',   element: <SuspenseWrapper><StudentProfile /></SuspenseWrapper> },

      // Teachers
      { path: 'teachers',              element: <SuspenseWrapper><TeacherList /></SuspenseWrapper> },

      // Classes
      { path: 'classes',               element: <SuspenseWrapper><ClassList /></SuspenseWrapper> },

      // Attendance
      { path: 'attendance',            element: <SuspenseWrapper><AttendancePage /></SuspenseWrapper> },

      // Finance
      { path: 'finance',               element: <SuspenseWrapper><FinancePage /></SuspenseWrapper> },
      { path: 'finance/:tab',          element: <SuspenseWrapper><FinancePage /></SuspenseWrapper> },

      // Behaviour
      { path: 'behaviour',             element: <SuspenseWrapper><BehaviourPage /></SuspenseWrapper> },

      // Exams & Grades
      { path: 'exams',                 element: <SuspenseWrapper><ExamsPage /></SuspenseWrapper> },

      // Grades & Assessment (CA/HW/MT/ET system)
      { path: 'grades',                element: <SuspenseWrapper><GradesPage /></SuspenseWrapper> },
      { path: 'grades/:tab',           element: <SuspenseWrapper><GradesPage /></SuspenseWrapper> },

      // Admissions
      { path: 'admissions',            element: <SuspenseWrapper><AdmissionsPage /></SuspenseWrapper> },

      // Timetable
      { path: 'timetable',             element: <SuspenseWrapper><TimetablePage /></SuspenseWrapper> },

      // Import / Export
      { path: 'import-export',         element: <SuspenseWrapper><ImportExportPage /></SuspenseWrapper> },

      // Settings
      { path: 'settings',              element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper> },
      { path: 'settings/:tab',         element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper> },

      // Fallback
      { path: '*',                     element: <SuspenseWrapper><NotFound /></SuspenseWrapper> },
    ],
  },
]);
