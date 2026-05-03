import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';

import AppShell from '@/components/layout/AppShell.jsx';
import ProtectedRoute from '@/components/guards/ProtectedRoute.jsx';
import { Spinner } from '@/components/ui/Spinner.jsx';

// ─── Eager pages ──────────────────────────────────────────────────────────────
import Login from '@/pages/Login.jsx';

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
const SettingsPage   = lazy(() => import('@/pages/settings/SettingsPage.jsx'));
const NotFound       = lazy(() => import('@/pages/NotFound.jsx'));

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

export const router = createBrowserRouter([
  // Public
  { path: '/login', element: <Login /> },

  // Protected shell
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true,                      element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard',                element: <SuspenseWrapper><Dashboard /></SuspenseWrapper> },

      // Students
      { path: 'students',                 element: <SuspenseWrapper><StudentList /></SuspenseWrapper> },
      { path: 'students/:studentId',      element: <SuspenseWrapper><StudentProfile /></SuspenseWrapper> },

      // Teachers
      { path: 'teachers',                 element: <SuspenseWrapper><TeacherList /></SuspenseWrapper> },

      // Classes
      { path: 'classes',                  element: <SuspenseWrapper><ClassList /></SuspenseWrapper> },

      // Attendance
      { path: 'attendance',               element: <SuspenseWrapper><AttendancePage /></SuspenseWrapper> },

      // Finance
      { path: 'finance',                  element: <SuspenseWrapper><FinancePage /></SuspenseWrapper> },
      { path: 'finance/:tab',             element: <SuspenseWrapper><FinancePage /></SuspenseWrapper> },

      // Behaviour
      { path: 'behaviour',                element: <SuspenseWrapper><BehaviourPage /></SuspenseWrapper> },

      // Exams & Grades
      { path: 'exams',                    element: <SuspenseWrapper><ExamsPage /></SuspenseWrapper> },

      // Admissions
      { path: 'admissions',               element: <SuspenseWrapper><AdmissionsPage /></SuspenseWrapper> },

      // Timetable
      { path: 'timetable',                element: <SuspenseWrapper><TimetablePage /></SuspenseWrapper> },

      // Settings
      { path: 'settings',                 element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper> },
      { path: 'settings/:tab',            element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper> },

      // 404
      { path: '*',                        element: <SuspenseWrapper><NotFound /></SuspenseWrapper> },
    ],
  },
]);
