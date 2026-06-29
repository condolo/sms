/* ============================================================
   Growth Profile Page — v4.22.0
   Verified learner development portfolio.
   Accessible via /growth-profile/:studentId
   Access point: StudentProfile header "Growth Profile" button.

   8 sections:
     1. Academic   — read-only from grades/attendance/reports
     2. Leadership — CRUD + verify
     3. Activities — CRUD + verify
     4. Projects   — CRUD + verify (supervisor ref)
     5. Service    — CRUD + verify
     6. Awards     — CRUD + verify
     7. Recommendations — staff-write, student-read
     8. Aspirations — student self-edit

   RBAC: growth_profile module (standard plan)
   ============================================================ */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, GraduationCap, Crown, Music, Layers,
  Heart, Award, MessageSquare, Compass, Loader2, AlertTriangle,
  TrendingUp, Shield, CheckCircle2, BookOpen, Hash,
} from 'lucide-react';
import { growthProfile as gpApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

import AcademicSection         from './sections/AcademicSection.jsx';
import LeadershipSection       from './sections/LeadershipSection.jsx';
import ActivitiesSection       from './sections/ActivitiesSection.jsx';
import ProjectsSection         from './sections/ProjectsSection.jsx';
import ServiceSection          from './sections/ServiceSection.jsx';
import AwardsSection           from './sections/AwardsSection.jsx';
import RecommendationsSection  from './sections/RecommendationsSection.jsx';
import AspirationsSection      from './sections/AspirationsSection.jsx';

/* ── Section definitions ─────────────────────────────────────── */
const SECTIONS = [
  { id: 'academic',        label: 'Academic',        Icon: GraduationCap, color: 'text-emerald-600' },
  { id: 'leadership',      label: 'Leadership',      Icon: Crown,         color: 'text-violet-600'  },
  { id: 'activities',      label: 'Activities',      Icon: Music,         color: 'text-blue-600'    },
  { id: 'projects',        label: 'Projects',        Icon: Layers,        color: 'text-indigo-600'  },
  { id: 'service',         label: 'Service',         Icon: Heart,         color: 'text-rose-600'    },
  { id: 'awards',          label: 'Awards',          Icon: Award,         color: 'text-amber-600'   },
  { id: 'recommendations', label: 'Recommendations', Icon: MessageSquare, color: 'text-teal-600'    },
  { id: 'aspirations',     label: 'Aspirations',     Icon: Compass,       color: 'text-orange-600'  },
];

/* ── Avatar gradient ─────────────────────────────────────────── */
const GRADIENTS = [
  'from-violet-500 to-purple-600', 'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',  'from-amber-500 to-orange-500',
  'from-pink-500 to-rose-500',     'from-indigo-500 to-blue-500',
];
function avatarGradient(name = '') {
  return GRADIENTS[(name.charCodeAt(0) || 0) % GRADIENTS.length];
}

/* ── Skeleton ────────────────────────────────────────────────── */
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded ${className}`} />;
}

/* ── Section nav item with count badge ──────────────────────── */
function NavItem({ section, active, count, verified, hasData, onClick }) {
  const { id, label, Icon, color } = section;
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
        active
          ? 'bg-slate-900 text-white'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
      }`}
    >
      <Icon size={15} className={active ? 'text-white' : color} />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {count != null && count > 0 && (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
          active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
        }`}>
          {count}
        </span>
      )}
      {hasData && count == null && (
        <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white/60' : 'bg-emerald-500'}`} />
      )}
    </button>
  );
}

/* ── Completion strip ────────────────────────────────────────── */
function CompletionStrip({ summary }) {
  if (!summary) return null;
  const { totalEntries, totalVerified, completionPct, hasAspirations } = summary;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-500">Verification progress</span>
          <span className="text-xs font-semibold text-slate-700">{totalVerified}/{totalEntries} verified</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-2 bg-emerald-500 rounded-full transition-all"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>
      {hasAspirations && (
        <div className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg shrink-0">
          <CheckCircle2 size={11} />
          Aspirations set
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
export default function GrowthProfilePage() {
  const { studentId }   = useParams();
  const [activeSection, setActiveSection] = useState('academic');

  const role    = useAuthStore(s => s.session?.user?.role ?? '');
  const canEdit   = ['admin', 'superadmin', 'teacher', 'section_head', 'deputy_principal'].includes(role);
  const isAdmin   = ['admin', 'superadmin', 'deputy_principal'].includes(role);
  const canVerify = canEdit;

  /* Profile meta + section counts */
  const { data: profileRes, isLoading, isError } = useQuery({
    queryKey: ['growth-profile', studentId],
    queryFn:  () => gpApi.profile(studentId),
    enabled:  !!studentId,
    staleTime: 2 * 60_000,
  });

  const profile  = profileRes?.data ?? null;
  const student  = profile?.student ?? null;
  const sections = profile?.sections ?? {};
  const summary  = profile?.summary ?? null;

  /* ── Loading ── */
  if (isLoading) return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-6xl mx-auto">
          <Skeleton className="h-4 w-32 mb-5" />
          <div className="flex items-center gap-4">
            <Skeleton className="w-14 h-14 rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex gap-6">
          <Skeleton className="w-52 h-96 rounded-xl shrink-0" />
          <Skeleton className="flex-1 h-96 rounded-xl" />
        </div>
      </div>
    </div>
  );

  /* ── Error ── */
  if (isError || !student) return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition">
          <ChevronLeft size={14} /> Students
        </Link>
        <div className="bg-white border border-slate-200 rounded-xl p-8 flex flex-col items-center gap-3">
          <AlertTriangle size={24} className="text-red-400" />
          <p className="text-sm text-slate-600">Student not found or access denied.</p>
        </div>
      </div>
    </div>
  );

  const grad     = avatarGradient(student.firstName ?? '');
  const initials = `${student.firstName?.charAt(0) ?? ''}${student.lastName?.charAt(0) ?? ''}`.toUpperCase();

  /* Section count helper */
  function sectionCount(id) {
    if (id === 'academic')        return null;
    if (id === 'recommendations') return sections.recommendations?.count;
    if (id === 'aspirations')     return null;
    return sections[id]?.count;
  }

  function sectionHasData(id) {
    if (id === 'aspirations') return sections.aspirations?.filled;
    return false;
  }

  /* Active section component */
  function renderSection() {
    switch (activeSection) {
      case 'academic':        return <AcademicSection studentId={studentId} />;
      case 'leadership':      return <LeadershipSection studentId={studentId} canEdit={canEdit} canVerify={canVerify} isAdmin={isAdmin} />;
      case 'activities':      return <ActivitiesSection studentId={studentId} canEdit={canEdit} canVerify={canVerify} isAdmin={isAdmin} />;
      case 'projects':        return <ProjectsSection studentId={studentId} canEdit={canEdit} canVerify={canVerify} isAdmin={isAdmin} />;
      case 'service':         return <ServiceSection studentId={studentId} canEdit={canEdit} canVerify={canVerify} isAdmin={isAdmin} />;
      case 'awards':          return <AwardsSection studentId={studentId} canEdit={canEdit} canVerify={canVerify} isAdmin={isAdmin} />;
      case 'recommendations': return <RecommendationsSection studentId={studentId} canEdit={canEdit} isAdmin={isAdmin} />;
      case 'aspirations':     return <AspirationsSection studentId={studentId} canEdit={canEdit || role === 'student'} />;
      default:                return null;
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <Link to={`/students/${studentId}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition">
              <ChevronLeft size={14} /> Student Profile
            </Link>
          </div>

          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${grad} flex items-center justify-center text-white text-base font-bold shrink-0 select-none`}>
              {initials}
            </div>

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-slate-900">
                  {student.firstName} {student.lastName}
                </h1>
                <span className="inline-flex items-center gap-1 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full">
                  <TrendingUp size={10} />
                  Growth Profile
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-slate-500">
                {student.admissionNumber && (
                  <span className="flex items-center gap-1"><Hash size={11} />{student.admissionNumber}</span>
                )}
                {student.className && (
                  <span className="flex items-center gap-1"><BookOpen size={11} />{student.className}</span>
                )}
                {summary && (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <Shield size={11} />
                    {summary.totalVerified} of {summary.totalEntries} entries verified
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 py-6">

        {/* Completion strip */}
        {summary && summary.totalEntries > 0 && (
          <div className="mb-5">
            <CompletionStrip summary={summary} />
          </div>
        )}

        <div className="flex gap-6 items-start">

          {/* ── Left nav ──────────────────────────────────────── */}
          <div className="w-52 shrink-0 sticky top-6">
            <div className="bg-white border border-slate-200 rounded-xl p-2 space-y-0.5">
              {SECTIONS.map(section => (
                <NavItem
                  key={section.id}
                  section={section}
                  active={activeSection === section.id}
                  count={sectionCount(section.id)}
                  hasData={sectionHasData(section.id)}
                  onClick={() => setActiveSection(section.id)}
                />
              ))}
            </div>
          </div>

          {/* ── Section content ───────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Section heading */}
            <div className="mb-5">
              {(() => {
                const sec = SECTIONS.find(s => s.id === activeSection);
                if (!sec) return null;
                const Icon = sec.Icon;
                return (
                  <div className="flex items-center gap-2">
                    <Icon size={18} className={sec.color} />
                    <h2 className="text-lg font-semibold text-slate-900">{sec.label}</h2>
                  </div>
                );
              })()}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                {renderSection()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
