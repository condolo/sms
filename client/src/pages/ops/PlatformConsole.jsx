/* ============================================================
   Platform Console — /ops
   Superadmin-only operational dashboard. Completely separate
   from school Settings. This page serves the operator, not schools.

   Sections:
     Health     — DB, uptime, storage, email
     Integrity  — orphans, duplicates, missing fields (live)
     Compliance — RBAC, tenant isolation, audit, backups, security
     Releases   — certificate history with trend charts
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import {
  Activity, ShieldCheck, Database, FileCheck, RefreshCcw,
  Loader2, CheckCircle2, AlertTriangle, XCircle, ChevronDown,
  ChevronUp, GitCommit, TrendingUp, Server, Lock, Layers,
  Eye, ArrowRight,
} from 'lucide-react';
import useAuthStore from '@/store/auth.js';
import { _get } from '@/api/client.js';

/* ── Data fetchers ─────────────────────────────────────────── */
const fetchHealth = ()  => _get('/ops/health');
const fetchCerts  = ()  => _get('/ops/certs?limit=30');

/* ── Status helpers ────────────────────────────────────────── */
const statusColor = {
  ok:       'text-emerald-600',
  warn:     'text-amber-600',
  error:    'text-red-600',
  critical: 'text-red-600',
  skipped:  'text-slate-400',
};
const statusBg = {
  ok:       'bg-emerald-50 border-emerald-200',
  warn:     'bg-amber-50 border-amber-200',
  error:    'bg-red-50 border-red-200',
  critical: 'bg-red-50 border-red-200',
  skipped:  'bg-slate-50 border-slate-200',
};
const StatusIcon = ({ status, size = 14 }) => {
  if (status === 'ok')                      return <CheckCircle2 size={size} className="text-emerald-500" />;
  if (status === 'warn')                    return <AlertTriangle size={size} className="text-amber-500" />;
  if (status === 'error' || status === 'critical') return <XCircle size={size} className="text-red-500" />;
  return <span className="w-3.5 h-3.5 rounded-full bg-slate-300 inline-block" />;
};

/* ── Reusable engine section ───────────────────────────────── */
function EngineSection({ icon: Icon, title, badge, badgeColor = 'bg-slate-100 text-slate-600', children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Icon size={15} className="text-slate-500" />
          <span className="text-sm font-semibold text-slate-700">{title}</span>
          {badge !== undefined && (
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>{badge}</span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

function CheckRow({ check }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <StatusIcon status={check.status} size={14} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-700">{check.label}</p>
        {check.detail && <p className="text-[11px] text-slate-400 mt-0.5">{check.detail}</p>}
        {check.count > 0 && check.samples?.length > 0 && (
          <p className="text-[11px] text-red-500 mt-0.5">
            Examples: {check.samples.slice(0, 3).join(', ')}
          </p>
        )}
      </div>
      <span className={`text-xs font-semibold flex-shrink-0 ${statusColor[check.status] ?? 'text-slate-500'}`}>
        {check.status === 'ok' ? 'OK'
          : check.status === 'skipped' ? 'SKIP'
          : check.count > 0 ? `${check.count} found`
          : check.status?.toUpperCase()}
      </span>
    </div>
  );
}

/* ── Verdict banner ────────────────────────────────────────── */
function VerdictBanner({ verdict, generatedAt, durationMs }) {
  const map = {
    CERTIFIED:           { color: 'border-emerald-200 bg-emerald-50', Icon: CheckCircle2,  iconColor: 'text-emerald-600', label: 'Platform Certified' },
    WARNINGS:            { color: 'border-amber-200 bg-amber-50',    Icon: AlertTriangle,  iconColor: 'text-amber-600',   label: 'Warnings Present' },
    ATTENTION_REQUIRED:  { color: 'border-red-200 bg-red-50',        Icon: XCircle,        iconColor: 'text-red-600',     label: 'Attention Required' },
  };
  const { color, Icon, iconColor, label } = map[verdict] ?? map.WARNINGS;
  return (
    <div className={`rounded-xl border p-4 flex items-center justify-between ${color}`}>
      <div className="flex items-center gap-3">
        <Icon size={22} className={iconColor} />
        <div>
          <p className={`text-base font-bold ${iconColor}`}>{label}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {generatedAt ? new Date(generatedAt).toLocaleString() : '—'}
            {durationMs ? ` · ${durationMs}ms` : ''}
          </p>
        </div>
      </div>
      <span className={`text-xs font-bold px-3 py-1.5 rounded-full tracking-wide ${
        verdict === 'CERTIFIED' ? 'bg-emerald-600 text-white' :
        verdict === 'ATTENTION_REQUIRED' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
      }`}>{verdict?.replace('_', ' ')}</span>
    </div>
  );
}

/* ── Gate summary cards ────────────────────────────────────── */
function GateCard({ icon: Icon, label, value, status, sub }) {
  const color = status === 'ok' ? 'border-emerald-200 bg-emerald-50'
    : status === 'error' || status === 'critical' ? 'border-red-200 bg-red-50'
    : 'border-amber-200 bg-amber-50';
  const textColor = status === 'ok' ? 'text-emerald-700'
    : status === 'error' || status === 'critical' ? 'text-red-700'
    : 'text-amber-700';
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="flex items-center justify-between mb-2">
        <Icon size={14} className={textColor} />
        <StatusIcon status={status} size={13} />
      </div>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${textColor}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ── Release trend chart (sparkline via CSS) ───────────────── */
function CertTrend({ certs }) {
  if (!certs?.length) return <p className="text-sm text-slate-400 italic">No release history found.</p>;

  return (
    <div className="space-y-2">
      {/* Trend header */}
      <div className="grid grid-cols-5 gap-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-1">
        <span className="col-span-2">Version / Commit</span>
        <span>RBAC</span>
        <span>Migration</span>
        <span>Verdict</span>
      </div>
      {certs.slice(0, 15).map((cert) => {
        const rbac    = cert.gates?.rbac?.coverage;
        const verdict = cert.verdict;
        return (
          <div key={cert.certId} className="grid grid-cols-5 gap-2 items-center py-2 px-1 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-colors">
            <div className="col-span-2 min-w-0">
              <p className="text-sm font-semibold text-slate-700 truncate">v{cert.version}</p>
              <p className="text-[11px] text-slate-400 truncate">{cert.commit?.short} {cert.commit?.message?.slice(0, 35)}</p>
            </div>
            <span className={`text-sm font-bold ${
              rbac == null ? 'text-slate-400' :
              rbac >= 90   ? 'text-emerald-600' :
              rbac >= 80   ? 'text-amber-600'   : 'text-red-600'
            }`}>{rbac != null ? `${rbac.toFixed(1)}%` : '—'}</span>
            <span className={`text-xs font-semibold ${cert.changes?.hasMigration ? 'text-amber-600' : 'text-slate-400'}`}>
              {cert.changes?.hasMigration ? 'Yes' : 'No'}
            </span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              verdict === 'CERTIFIED'          ? 'bg-emerald-100 text-emerald-700' :
              verdict === 'ATTENTION_REQUIRED' ? 'bg-red-100 text-red-700'         :
                                                 'bg-amber-100 text-amber-700'
            }`}>{verdict === 'CERTIFIED' ? '✓' : '!'} {verdict?.split('_')[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*  Main Platform Console                                      */
/* ════════════════════════════════════════════════════════════ */
export default function PlatformConsole() {
  const role = useAuthStore(s => s.session?.user?.role);

  if (role !== 'superadmin') {
    return <Navigate to="/" replace />;
  }

  const { data: healthRes, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['ops', 'health'],
    queryFn:  fetchHealth,
    staleTime: 60_000,
    retry: 1,
  });

  const { data: certsRes } = useQuery({
    queryKey: ['ops', 'certs'],
    queryFn:  fetchCerts,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const d     = healthRes?.data;
  const certs = certsRes?.data ?? [];

  /* Derive top-level gate statuses from engine summaries */
  const healthStatus     = d ? (d.health?.summary?.down > 0 ? 'error' : d.health?.summary?.degraded > 0 ? 'warn' : 'ok') : null;
  const integrityStatus  = d ? (d.integrity?.summary?.critical > 0 ? 'critical' : d.integrity?.summary?.warn > 0 ? 'warn' : 'ok') : null;
  const complianceStatus = d ? (d.compliance?.summary?.failed > 0 ? 'error' : d.compliance?.summary?.warned > 0 ? 'warn' : 'ok') : null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-2">
              <Layers size={18} className="text-violet-600" />
              Platform Console
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">Operational health · Integrity · Compliance · Release history</p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCcw size={12} className={isFetching ? 'animate-spin' : ''} />
            {isFetching ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">

        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-sm">Running platform health checks…</p>
          </div>
        )}

        {/* Error */}
        {!isLoading && (isError || !d) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center space-y-2">
            <XCircle size={24} className="text-red-500 mx-auto" />
            <p className="text-sm font-medium text-red-700">Failed to load platform health data</p>
            <button onClick={() => refetch()} className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700">Retry</button>
          </div>
        )}

        {d && (<>

          {/* Verdict */}
          <VerdictBanner verdict={d.verdict} generatedAt={d.generatedAt} durationMs={d.durationMs} />

          {/* Gate cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <GateCard icon={Server}     label="Health"     value={d.health?.overall?.toUpperCase() ?? '—'}    status={healthStatus}     sub={`${d.health?.summary?.healthy ?? 0}/${d.health?.summary?.total ?? 0} checks`} />
            <GateCard icon={Database}   label="Integrity"  value={integrityStatus === 'ok' ? 'CLEAN' : `${(d.integrity?.summary?.critical ?? 0) + (d.integrity?.summary?.warn ?? 0)} issue(s)`} status={integrityStatus}  sub={`${d.integrity?.summary?.ok ?? 0} of ${d.integrity?.summary?.total ?? 0} rules clean`} />
            <GateCard icon={Lock}       label="Compliance" value={`${d.compliance?.score ?? 0}%`}             status={complianceStatus} sub={`${d.compliance?.summary?.passed ?? 0}/${d.compliance?.summary?.total ?? 0} checks`} />
            <GateCard icon={FileCheck}  label="Releases"   value={`${certs.length} certs`}                    status="ok"               sub={certs[0] ? `Latest: v${certs[0].version}` : 'No history'} />
          </div>

          {/* ── Health Engine ──────────────────────────────── */}
          <EngineSection
            icon={Server}
            title="Health Engine"
            badge={d.health?.overall}
            badgeColor={healthStatus === 'ok' ? 'bg-emerald-100 text-emerald-700' : healthStatus === 'warn' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}
          >
            <div>
              {(d.health?.checks ?? []).map(check => <CheckRow key={check.id} check={check} />)}
            </div>
          </EngineSection>

          {/* ── Integrity Engine ───────────────────────────── */}
          <EngineSection
            icon={Activity}
            title="Integrity Engine"
            badge={`${(d.integrity?.summary?.critical ?? 0) + (d.integrity?.summary?.warn ?? 0)} issue(s)`}
            badgeColor={(d.integrity?.summary?.critical ?? 0) > 0 ? 'bg-red-100 text-red-700' : (d.integrity?.summary?.warn ?? 0) > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}
          >
            {d.integrity?.rules?.length > 0 ? (
              <div>
                {d.integrity.rules.map(rule => <CheckRow key={rule.id} check={{ ...rule, label: rule.label, detail: rule.skippedReason }} />)}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">No integrity rules returned.</p>
            )}
          </EngineSection>

          {/* ── Compliance Engine ──────────────────────────── */}
          <EngineSection
            icon={ShieldCheck}
            title="Compliance Engine"
            badge={`${d.compliance?.score ?? 0}%`}
            badgeColor={complianceStatus === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}
          >
            <div>
              {(d.compliance?.checks ?? []).map(check => <CheckRow key={check.id} check={check} />)}
            </div>
          </EngineSection>

          {/* ── Release History ─────────────────────────────── */}
          <EngineSection icon={GitCommit} title="Release History" badge={`${certs.length} releases`} badgeColor="bg-slate-100 text-slate-600">
            <CertTrend certs={certs} />
            {certs.length === 0 && (
              <p className="text-xs text-slate-400 mt-3 bg-slate-50 rounded-lg p-3">
                No certificates in the database yet. Run{' '}
                <code className="bg-slate-100 px-1 rounded">npm run platform:release-cert</code>{' '}
                after each deploy to build your release history.
              </p>
            )}
          </EngineSection>

          {/* ── Pre-Release Smoke Checklist ─────────────────── */}
          <EngineSection icon={Eye} title="Pre-Release Smoke Checklist" defaultOpen={false}>
            <p className="text-xs text-slate-500 mb-3">Run against staging before every production deployment.</p>
            <div className="space-y-2">
              {[
                ['auth',    'Can log in as admin, teacher, parent, and student?'],
                ['shell',   'Dashboard loads with no console errors?'],
                ['students','Students list opens and search returns results?'],
                ['attend',  'Attendance can be submitted for today?'],
                ['finance', 'Finance invoice can be created and receipted?'],
                ['exams',   'Exam marks can be entered and saved?'],
                ['reports', 'Report card PDF downloads with correct student data?'],
                ['parent',  'Parent portal shows attendance and results?'],
                ['student', 'Student portal shows dashboard?'],
                ['logout',  'Logout clears session and redirects to login?'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                  <input type="checkbox" className="w-4 h-4 rounded accent-violet-600" />
                  <span className="text-sm text-slate-600 group-hover:text-slate-900">{label}</span>
                </label>
              ))}
            </div>
          </EngineSection>

        </>)}
      </div>
    </div>
  );
}
