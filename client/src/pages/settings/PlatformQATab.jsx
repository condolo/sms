/* ============================================================
   Platform QA Dashboard Tab — superadmin only
   Shows the complete platform health snapshot in one place:
   gates, DB counts, integrity, release certificate, errors.
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck, Database, CheckCircle2, AlertTriangle,
  XCircle, RefreshCcw, Loader2, ChevronDown, ChevronUp,
  FileCheck, GitCommit, Clock, Activity, Info,
  Server, Lock, FlaskConical, Layers,
} from 'lucide-react';
import { _get } from '@/api/client.js';

/* ── API call ──────────────────────────────────────────────── */
const fetchQAHealth = () => _get('/qa/health');

/* ── Sub-components ────────────────────────────────────────── */
function GateCard({ icon: Icon, label, value, passed, note }) {
  const color = passed === true
    ? 'border-emerald-200 bg-emerald-50'
    : passed === false
    ? 'border-red-200 bg-red-50'
    : 'border-amber-200 bg-amber-50';

  const textColor = passed === true ? 'text-emerald-700'
    : passed === false ? 'text-red-700'
    : 'text-amber-700';

  const StatusIcon = passed === true ? CheckCircle2 : passed === false ? XCircle : AlertTriangle;
  const iconColor  = passed === true ? 'text-emerald-500' : passed === false ? 'text-red-500' : 'text-amber-500';

  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon size={15} className={textColor} />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
        </div>
        <StatusIcon size={15} className={iconColor} />
      </div>
      <p className={`mt-2 text-lg font-bold ${textColor}`}>{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50">
        <Icon size={14} className="text-slate-400" />
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function StatusRow({ label, value, status, detail }) {
  const dot = status === 'ok'    ? 'bg-emerald-500'
    : status === 'warn'          ? 'bg-amber-500'
    : status === 'error'         ? 'bg-red-500'
    : 'bg-slate-300';

  return (
    <div className="flex items-start justify-between py-2 border-b border-slate-50 last:border-0">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${dot}`} />
        <div>
          <p className="text-sm text-slate-700">{label}</p>
          {detail && <p className="text-[11px] text-slate-400 mt-0.5">{detail}</p>}
        </div>
      </div>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
        status === 'ok'    ? 'bg-emerald-100 text-emerald-700'
        : status === 'warn'  ? 'bg-amber-100 text-amber-700'
        : status === 'error' ? 'bg-red-100 text-red-700'
        : 'bg-slate-100 text-slate-600'
      }`}>{value}</span>
    </div>
  );
}

function CollapsibleSection({ title, icon: Icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</span>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {open && <div className="p-5">{children}</div>}
    </div>
  );
}

/* ── Verdict Banner ────────────────────────────────────────── */
function VerdictBanner({ verdict, generatedAt, durationMs }) {
  const certified = verdict === 'CERTIFIED';
  return (
    <div className={`rounded-xl border p-4 flex items-center justify-between ${
      certified ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
    }`}>
      <div className="flex items-center gap-3">
        {certified
          ? <CheckCircle2 size={22} className="text-emerald-600" />
          : <AlertTriangle size={22} className="text-amber-600" />}
        <div>
          <p className={`text-base font-bold ${certified ? 'text-emerald-700' : 'text-amber-700'}`}>
            {certified ? 'Platform Certified' : 'Attention Required'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Checked {generatedAt ? new Date(generatedAt).toLocaleString() : '—'}
            {durationMs ? ` · ${durationMs}ms` : ''}
          </p>
        </div>
      </div>
      <span className={`text-xs font-bold px-3 py-1 rounded-full tracking-wide ${
        certified ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
      }`}>{verdict?.replace('_', ' ')}</span>
    </div>
  );
}

/* ── Release Certificate Card ──────────────────────────────── */
function CertCard({ cert }) {
  if (!cert) return (
    <p className="text-sm text-slate-500 italic">
      No release certificate found. Run <code className="bg-slate-100 px-1 rounded text-xs">npm run platform:release-cert</code> to generate one.
    </p>
  );

  const certified = cert.verdict === 'CERTIFIED';
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
          certified ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
        }`}>{cert.verdict}</span>
        <span className="text-sm font-semibold text-slate-700">v{cert.version}</span>
        <span className="text-xs text-slate-400">{cert.commit?.short} · {cert.commit?.message?.slice(0, 60)}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Cert ID',    cert.certId?.slice(0, 8) + '…'],
          ['Branch',     cert.branch],
          ['Author',     cert.commit?.author],
          ['Generated',  cert.generatedAt ? new Date(cert.generatedAt).toLocaleDateString() : '—'],
        ].map(([label, value]) => (
          <div key={label} className="bg-slate-50 rounded-lg p-3">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
            <p className="text-sm font-medium text-slate-700 mt-0.5 truncate">{value ?? '—'}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          ['RBAC',     cert.gates?.rbac?.passed,     cert.gates?.rbac?.coverage != null ? `${cert.gates.rbac.coverage.toFixed(2)}%` : '—'],
          ['Security', cert.gates?.security?.passed,  cert.gates?.security?.passed ? 'PASS' : 'FAIL'],
          ['Tests',    cert.gates?.tests?.passed,     cert.gates?.tests?.note],
          ['Migration',!cert.changes?.hasMigration,   cert.changes?.hasMigration ? 'Present' : 'None'],
        ].map(([label, passed, val]) => (
          <div key={label} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
            <span className="text-slate-500">{label}</span>
            <span className={`font-semibold ${passed ? 'text-emerald-600' : 'text-red-600'}`}>{val ?? '—'}</span>
          </div>
        ))}
      </div>

      {cert.blockers?.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
          {cert.blockers.map((b, i) => (
            <p key={i} className="text-xs text-red-700 flex items-center gap-1.5">
              <XCircle size={11} className="flex-shrink-0" /> {b}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════ */
/*  Main component                                             */
/* ════════════════════════════════════════════════════════════ */
export default function PlatformQATab() {
  const { data: res, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['qa', 'health'],
    queryFn:  fetchQAHealth,
    staleTime: 60_000,
    retry: 1,
  });

  const d = res?.data;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-sm">Running platform health checks…</p>
      </div>
    );
  }

  if (isError || !d) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center space-y-2">
        <XCircle size={24} className="text-red-500 mx-auto" />
        <p className="text-sm font-medium text-red-700">Failed to load QA health data</p>
        <p className="text-xs text-red-500">Check server logs and ensure you are logged in as superadmin.</p>
        <button onClick={() => refetch()} className="mt-2 text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700">
          Retry
        </button>
      </div>
    );
  }

  const integrity  = d.integrity ?? [];
  const intWarn    = integrity.filter(c => c.status === 'warn');
  const intOk      = integrity.filter(c => c.status === 'ok');

  return (
    <div className="max-w-4xl space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Platform QA Dashboard</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            v{d.platform?.version} · Node {d.platform?.nodeVersion} · Uptime {Math.floor((d.platform?.uptime ?? 0) / 60)}m
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCcw size={12} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Verdict */}
      <VerdictBanner verdict={d.verdict} generatedAt={d.generatedAt} durationMs={d.durationMs} />

      {/* Gate summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <GateCard
          icon={Lock}
          label="RBAC"
          value={`${d.rbac?.coverage?.toFixed(2) ?? '—'}%`}
          passed={d.gates?.rbac?.passed}
          note={`Baseline ${d.rbac?.baseline?.toFixed(2) ?? '—'}% · ${d.rbac?.gaps ?? 0} gap(s)`}
        />
        <GateCard
          icon={ShieldCheck}
          label="Integrity"
          value={intWarn.length === 0 ? 'CLEAN' : `${intWarn.length} issue(s)`}
          passed={intWarn.length === 0}
          note={`${intOk.length} of ${integrity.length} checks clean`}
        />
        <GateCard
          icon={FlaskConical}
          label="Tests"
          value={`${d.tests?.fileCount ?? 0} files`}
          passed={(d.tests?.fileCount ?? 0) > 0}
          note="Run npm test to execute"
        />
        <GateCard
          icon={Database}
          label="DB"
          value={d.platform?.dbConnected ? 'Connected' : 'Disconnected'}
          passed={d.platform?.dbConnected}
          note={`${d.migration?.status === 'complete' ? 'Migrations complete' : 'Migration pending'}`}
        />
      </div>

      {/* Release Certificate */}
      <SectionHeader icon={FileCheck} title="Latest Release Certificate">
        <CertCard cert={d.latestCert} />
      </SectionHeader>

      {/* Data Integrity */}
      <CollapsibleSection icon={Activity} title="Data Integrity Checks" defaultOpen={intWarn.length > 0}>
        <div className="space-y-0">
          {integrity.map(check => (
            <StatusRow
              key={check.label}
              label={check.label}
              value={check.count === 0 ? 'Clean' : check.count === -1 ? 'Error' : `${check.count} found`}
              status={check.status}
              detail={check.count > 0 && check.samples?.length > 0
                ? `Examples: ${check.samples.slice(0, 3).join(', ')}`
                : undefined}
            />
          ))}
          {integrity.length === 0 && (
            <p className="text-sm text-slate-400 italic">No integrity checks returned.</p>
          )}
        </div>
      </CollapsibleSection>

      {/* Collection Counts */}
      <CollapsibleSection icon={Database} title="Collection Counts (Critical Collections)">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(d.collections ?? []).map(col => (
            <div key={col.key} className="bg-slate-50 rounded-lg p-3">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide truncate">{col.label}</p>
              <p className="text-lg font-bold text-slate-800 mt-0.5">
                {col.count === -1 ? <span className="text-slate-300 text-sm">—</span> : col.count.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* RBAC detail */}
      <CollapsibleSection icon={Lock} title="RBAC Coverage Detail">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Coverage',  `${d.rbac?.coverage?.toFixed(2) ?? '—'}%`],
              ['Protected', `${d.rbac?.protected ?? '—'} / ${d.rbac?.total ?? '—'}`],
              ['Baseline',  `${d.rbac?.baseline?.toFixed(2) ?? '—'}%`],
            ].map(([label, value]) => (
              <div key={label} className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
                <p className="text-base font-bold text-slate-800 mt-0.5">{value}</p>
              </div>
            ))}
          </div>
          {d.rbac?.gaps > 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {d.rbac.gaps} endpoint(s) are missing RBAC or annotation coverage.
              Run <code className="bg-amber-100 px-1 rounded">npm run platform:coverage</code> for details.
            </p>
          )}
        </div>
      </CollapsibleSection>

      {/* Error Log */}
      <CollapsibleSection icon={AlertTriangle} title="Error Log (Today)">
        {d.errors?.available === false ? (
          <p className="text-sm text-slate-400 italic">Log directory not available.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">
              <span className="font-semibold">{d.errors?.todayErrors ?? 0}</span> error(s) logged today
            </p>
            {(d.errors?.recentErrors ?? []).map((line, i) => (
              <pre key={i} className="text-[11px] text-slate-500 bg-slate-50 rounded p-2 overflow-x-auto">{line.slice(0, 200)}</pre>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Pre-release Smoke Checklist */}
      <CollapsibleSection icon={Layers} title="Pre-Release Smoke Checklist">
        <div className="space-y-1.5">
          {[
            'Can log in?',
            'Dashboard loads for admin, teacher, parent, student?',
            'Students list opens and search works?',
            'Attendance can be submitted?',
            'Finance invoice can be created?',
            'Exam marks can be entered?',
            'Report card PDF downloads?',
            'Parent portal accessible?',
            'Student portal accessible?',
            'Logout works?',
          ].map(item => (
            <label key={item} className="flex items-center gap-2 cursor-pointer group">
              <input type="checkbox" className="w-3.5 h-3.5 rounded accent-emerald-600" />
              <span className="text-sm text-slate-600 group-hover:text-slate-900">{item}</span>
            </label>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
          Run this checklist against staging before every production deployment.
        </p>
      </CollapsibleSection>

      {/* DB Connection + Platform info */}
      <SectionHeader icon={Server} title="Platform Runtime">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 text-sm">
          {[
            ['Version',     `v${d.platform?.version ?? '—'}`],
            ['Node.js',     d.platform?.nodeVersion ?? '—'],
            ['Database',    d.platform?.dbConnected ? 'Connected' : 'Disconnected'],
            ['Uptime',      `${Math.floor((d.platform?.uptime ?? 0) / 60)} min`],
            ['Check time',  `${d.durationMs ?? '—'}ms`],
            ['Timestamp',   d.generatedAt ? new Date(d.generatedAt).toLocaleTimeString() : '—'],
          ].map(([label, value]) => (
            <div key={label} className="space-y-0.5">
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
              <p className="text-sm font-medium text-slate-700">{value}</p>
            </div>
          ))}
        </div>
      </SectionHeader>

    </div>
  );
}
