import { createBrowserRouter, Navigate, useRouteError } from 'react-router-dom';
import { lazy, Suspense } from 'react';

import AppShell from '@/components/layout/AppShell.jsx';
import ProtectedRoute from '@/components/guards/ProtectedRoute.jsx';
import { Spinner } from '@/components/ui/Spinner.jsx';
import { detectSchool } from '@/utils/schoolDetect.js';

// ─── Eager pages ──────────────────────────────────────────────────────────────
import Login   from '@/pages/Login.jsx';
import Landing from '@/pages/Landing.jsx';
import Contact       from '@/pages/Contact.jsx';
import Plans         from '@/pages/Plans.jsx';
import FAQ           from '@/pages/FAQ.jsx';
import PrivacyPolicy from '@/pages/legal/PrivacyPolicy.jsx';
import TermsOfService from '@/pages/legal/TermsOfService.jsx';

// ─── Lazy pages ───────────────────────────────────────────────────────────────
const Dashboard      = lazy(() => import('@/pages/Dashboard.jsx'));
const StudentList    = lazy(() => import('@/pages/students/StudentList.jsx'));
const StudentProfile = lazy(() => import('@/pages/students/StudentProfile.jsx'));
const TeacherList    = lazy(() => import('@/pages/teachers/TeacherList.jsx'));
const ClassList      = lazy(() => import('@/pages/classes/ClassList.jsx'));
const ClassDetail    = lazy(() => import('@/pages/classes/ClassDetail.jsx'));
const AttendancePage = lazy(() => import('@/pages/attendance/AttendancePage.jsx'));
const FinancePage    = lazy(() => import('@/pages/finance/FinancePage.jsx'));
const BehaviourPage  = lazy(() => import('@/pages/behaviour/BehaviourPage.jsx'));
const AdmissionsPage = lazy(() => import('@/pages/admissions/AdmissionsPage.jsx'));
const TimetablePage  = lazy(() => import('@/pages/timetable/TimetablePage.jsx'));
const SettingsPage      = lazy(() => import('@/pages/settings/SettingsPage.jsx'));
const ExamsPage         = lazy(() => import('@/pages/exams/ExamsPage.jsx'));
// ImportExportPage dissolved into individual modules (v4.18.0)
const SubjectsPage      = lazy(() => import('@/pages/subjects/SubjectsPage.jsx'));
const MessagesPage      = lazy(() => import('@/pages/messages/MessagesPage.jsx'));
const NotFound          = lazy(() => import('@/pages/NotFound.jsx'));
const EventsPage        = lazy(() => import('@/pages/events/EventsPage.jsx'));
const ReportsPage       = lazy(() => import('@/pages/reports/ReportsPage.jsx'));
const HRPage            = lazy(() => import('@/pages/hr/HRPage.jsx'));
const ChangelogPage     = lazy(() => import('@/pages/changelog/ChangelogPage.jsx'));
const HelpPage          = lazy(() => import('@/pages/help/HelpPage.jsx'));
const ProfilePage       = lazy(() => import('@/pages/profile/ProfilePage.jsx'));
const GrowthProfilePage = lazy(() => import('@/pages/growth-profile/GrowthProfilePage.jsx'));
const LibraryPage       = lazy(() => import('@/pages/library/LibraryPage.jsx'));
const TransportPage     = lazy(() => import('@/pages/transport/TransportPage.jsx'));
const HostelPage        = lazy(() => import('@/pages/hostel/HostelPage.jsx'));
const LessonsPage          = lazy(() => import('@/pages/lessons/LessonsPage.jsx'));
const ELearningPage        = lazy(() => import('@/pages/elearning/ELearningPage.jsx'));
const StudentDashboard     = lazy(() => import('@/pages/student-portal/StudentDashboard.jsx'));
const ParentDashboard      = lazy(() => import('@/pages/parent-portal/ParentDashboard.jsx'));

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

// ─── Route-level error boundary ───────────────────────────────────────────────
// React Router's built-in error handling catches lazy-chunk failures before they
// reach window event handlers or the outer ErrorBoundary.  This component is
// set as errorElement on the layout route so chunk errors silently reload and
// genuine app errors show a clean page instead of the default React Router banner.
function RouteErrorBoundary() {
  const error = useRouteError();
  const msg   = (error?.message ?? '') + (error?.stack ?? '');
  const isChunkError =
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Unable to preload CSS');

  if (isChunkError) {
    window.location.reload();
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Something went wrong</h1>
        <p className="text-slate-500 mb-6 text-sm leading-relaxed">
          The page ran into an unexpected error. Refreshing usually fixes it — if it
          keeps happening, contact support.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Refresh page
        </button>
        {import.meta.env.DEV && (
          <pre className="mt-6 text-left text-xs bg-red-50 text-red-700 rounded-lg p-4 overflow-auto max-h-48 whitespace-pre-wrap">
            {String(error?.message ?? error)}
          </pre>
        )}
      </div>
    </div>
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

  // Contact — public, no auth required
  { path: '/contact', element: <Contact /> },

  // Plans — public pricing comparison
  { path: '/plans', element: <Plans /> },

  // FAQ — public
  { path: '/faq', element: <FAQ /> },

  // Legal — public, no auth required
  { path: '/privacy', element: <PrivacyPolicy /> },
  { path: '/terms',   element: <TermsOfService /> },

  // Login — branded when on school subdomain, generic otherwise
  { path: '/login', element: <Login /> },

  // Student portal — accessible after student login (no AppShell)
  { path: '/student-dashboard', element: <SuspenseWrapper><StudentDashboard /></SuspenseWrapper> },

  // Parent portal — accessible after parent login (no AppShell)
  { path: '/parent-dashboard', element: <SuspenseWrapper><ParentDashboard /></SuspenseWrapper> },

  // Protected shell — only reachable after authentication
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: 'dashboard',             element: <SuspenseWrapper><Dashboard /></SuspenseWrapper> },

      // Students
      { path: 'students',              element: <SuspenseWrapper><StudentList /></SuspenseWrapper> },
      { path: 'students/:studentId',   element: <SuspenseWrapper><StudentProfile /></SuspenseWrapper> },

      // Teachers
      { path: 'teachers',              element: <SuspenseWrapper><TeacherList /></SuspenseWrapper> },

      // Classes
      { path: 'classes',               element: <SuspenseWrapper><ClassList /></SuspenseWrapper> },
      { path: 'classes/:classId',      element: <SuspenseWrapper><ClassDetail /></SuspenseWrapper> },

      // Attendance
      { path: 'attendance',            element: <SuspenseWrapper><AttendancePage /></SuspenseWrapper> },

      // Finance
      { path: 'finance',               element: <SuspenseWrapper><FinancePage /></SuspenseWrapper> },
      { path: 'finance/:tab',          element: <SuspenseWrapper><FinancePage /></SuspenseWrapper> },

      // Behaviour
      { path: 'behaviour',             element: <SuspenseWrapper><BehaviourPage /></SuspenseWrapper> },

      // Formal Exams (scheduling, results, grade report) — ExamsPage v4.33.0
      { path: 'exams',                 element: <SuspenseWrapper><ExamsPage /></SuspenseWrapper> },
      { path: 'exams/:tab',            element: <SuspenseWrapper><ExamsPage /></SuspenseWrapper> },

      // Admissions
      { path: 'admissions',            element: <SuspenseWrapper><AdmissionsPage /></SuspenseWrapper> },

      // Timetable
      { path: 'timetable',             element: <SuspenseWrapper><TimetablePage /></SuspenseWrapper> },

      // Subjects & Departments
      { path: 'subjects',              element: <SuspenseWrapper><SubjectsPage /></SuspenseWrapper> },

      // Messages
      { path: 'messages',              element: <SuspenseWrapper><MessagesPage /></SuspenseWrapper> },

      // Settings
      { path: 'settings',              element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper> },
      { path: 'settings/:tab',         element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper> },

      // Events & Calendar
      { path: 'events',                element: <SuspenseWrapper><EventsPage /></SuspenseWrapper> },

      // Reports & Analytics
      { path: 'reports',               element: <SuspenseWrapper><ReportsPage /></SuspenseWrapper> },

      // HR & Staff
      { path: 'hr',                    element: <SuspenseWrapper><HRPage /></SuspenseWrapper> },

      // Changelog
      { path: 'changelog',             element: <SuspenseWrapper><ChangelogPage /></SuspenseWrapper> },

      // Help Centre
      { path: 'help',                  element: <SuspenseWrapper><HelpPage /></SuspenseWrapper> },

      // Profile
      { path: 'profile',               element: <SuspenseWrapper><ProfilePage /></SuspenseWrapper> },

      // Growth Profile (v4.22.0)
      { path: 'growth-profile/:studentId', element: <SuspenseWrapper><GrowthProfilePage /></SuspenseWrapper> },

      // Library (v4.29.0)
      { path: 'library',                element: <SuspenseWrapper><LibraryPage /></SuspenseWrapper> },

      // Transport (v4.29.0)
      { path: 'transport',              element: <SuspenseWrapper><TransportPage /></SuspenseWrapper> },

      // Hostel (v4.29.0)
      { path: 'hostel',                 element: <SuspenseWrapper><HostelPage /></SuspenseWrapper> },

      // Lessons / Syllabus Tracker (v4.33.0)
      { path: 'lessons',                element: <SuspenseWrapper><LessonsPage /></SuspenseWrapper> },

      // eLearning — sub-routes for each tool
      { path: 'elearning',              element: <SuspenseWrapper><ELearningPage /></SuspenseWrapper> },
      { path: 'elearning/sessions',     element: <SuspenseWrapper><ELearningPage /></SuspenseWrapper> },
      { path: 'elearning/classroom',    element: <SuspenseWrapper><ELearningPage /></SuspenseWrapper> },
      { path: 'elearning/meet',         element: <SuspenseWrapper><ELearningPage /></SuspenseWrapper> },
      { path: 'elearning/zoom',         element: <SuspenseWrapper><ELearningPage /></SuspenseWrapper> },

      // Fallback
      { path: '*',                     element: <SuspenseWrapper><NotFound /></SuspenseWrapper> },
    ],
  },
]);
