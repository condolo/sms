/* ============================================================
   Platform analytics — the live half of the control center.

   Reads only the pre-aggregated telemetry collections. Polls
   while the tab is visible; stops when it is hidden. No chart
   library: a sparkline is 20 lines of SVG.
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, BarChart3, Clock, Database, Gauge,
  Globe2, Loader2, RefreshCcw, Server, TrendingUp, Users, Zap,
} from 'lucide-react';
import { _get } from '@/api/client.js';

const nf = new Intl.NumberFormat('en-KE');

function fmt(n) {
  if (n == null) return '—';
  return nf.format(Math.round(n));
}
function pct(n) {
  if (n == null) return '—';
  return `${n > 0 && n < 1 ? n.toFixed(1) : Math.round(n * 10) / 10}%`;
}
function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
function timeLabel(t, range) {
  const d = new Date(t);
  if (range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === '7d') return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/* ── Tiny SVG sparkline ─────────────────────────────────────── */
function Spark({ points, pick, color = '#7c3aed', height = 52, fill = true }) {
  const vals = (points || []).map((p) => Number(pick(p)) || 0);
  const max = Math.max(1, ...vals);
  const n = vals.length;
  if (n < 2) return <div className="h-[52px] rounded bg-slate-50" />;
  const coords = vals.map((v, i) => {
    const x = (i / (n - 1)) * 100;
    const y = 30 - (v / max) * 27;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const area = `0,30 ${coords.join(' ')} 100,30`;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ height }} className="w-full">
      {fill && <polygon points={area} fill={color} opacity="0.10" />}
      <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ icon: Icon, label, value, sub, tone = 'slate' }) {
  const tones = {
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || tones.slate}`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide opacity-80">
        <Icon size={13} /> {label}
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub ? <p className="text-[11px] opacity-70 mt-0.5">{sub}</p> : null}
    </div>
  );
}

function Meter({ label, value, max, unit = '', hint }) {
  const p = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-800 tabular-nums">
          {value == null ? '—' : `${value}${unit}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${p}%` }} />
      </div>
      {hint ? <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p> : null}
    </div>
  );
}

function Panel({ title, icon: Icon, right, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function errTone(rate) {
  if (rate >= 5) return 'text-red-600';
  if (rate >= 1) return 'text-amber-600';
  return 'text-emerald-600';
}

export default function PlatformAnalytics() {
  const [range, setRange] = useState('24h');

  const overviewQ = useQuery({
    queryKey: ['platform', 'analytics', 'overview'],
    queryFn: () => _get('/platform/analytics/overview'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    retry: 1,
  });

  const historyQ = useQuery({
    queryKey: ['platform', 'analytics', 'history', range],
    queryFn: () => _get('/platform/analytics/history', { range }),
    staleTime: 30_000,
    retry: 1,
  });

  const errorsQ = useQuery({
    queryKey: ['platform', 'analytics', 'errors', range],
    queryFn: () => _get('/platform/analytics/errors', { range }),
    staleTime: 30_000,
    retry: 1,
  });

  const systemQ = useQuery({
    queryKey: ['platform', 'analytics', 'system'],
    queryFn: () => _get('/platform/analytics/system'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
    retry: 1,
  });

  const d = overviewQ.data?.data;
  const history = historyQ.data?.data;
  const errors = errorsQ.data?.data ?? [];
  const system = systemQ.data?.data;

  if (overviewQ.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
        <Loader2 size={18} className="animate-spin" /> Starting the meters…
      </div>
    );
  }

  if (overviewQ.isError || !d) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">Analytics aren’t answering yet.</p>
          <p className="text-xs mt-0.5 text-amber-700">
            The page still works; telemetry starts collecting on the first authenticated request after deploy.
          </p>
        </div>
      </div>
    );
  }

  const health = system?.health || d.system || {};
  const telemetry = system?.telemetry || d.telemetry || {};
  const heapPct = health.heapTotalMb ? Math.round((health.heapUsedMb / health.heapTotalMb) * 100) : 0;
  const bufferPct = Math.min(100, Math.round(((telemetry.bufferedRoutes || 0) / 2000) * 100));
  const flushAge = telemetry.lastFlushAt
    ? Math.round((Date.now() - new Date(telemetry.lastFlushAt).getTime()) / 1000)
    : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Gauge size={17} className="text-violet-600" /> Live analytics
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Active people, traffic, latency, modules and machine health — refreshed every 30 s while this tab is open.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {['24h', '7d', '30d'].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${
                  range === r ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            onClick={() => { void overviewQ.refetch(); void systemQ.refetch(); }}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <RefreshCcw size={12} className={overviewQ.isFetching ? 'animate-spin' : ''} />
            {overviewQ.isFetching ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Top line ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Users} label="Active now" value={fmt(d.users.now)} tone="violet" sub={`${fmt(d.users.m15)} in 15 min`} />
        <Stat icon={Activity} label="Active 1 h" value={fmt(d.users.h1)} tone="violet" sub={Object.entries(d.users.byRole || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'no roles yet'} />
        <Stat icon={TrendingUp} label="Requests / min" value={fmt(d.traffic.perMinute)} tone="slate" sub={`${fmt(d.traffic.requests)} in the last hour`} />
        <Stat icon={Zap} label="p95 latency" value={`${d.traffic.p95} ms`} tone={d.traffic.p95 > 500 ? 'amber' : 'emerald'} sub={`p50 ${d.traffic.p50} ms · p99 ${d.traffic.p99} ms`} />
        <Stat icon={AlertTriangle} label="5xx error rate" value={pct(d.traffic.errorRate)} tone={d.traffic.errorRate >= 1 ? 'red' : 'emerald'} sub={`${fmt(d.traffic.errors5)} server · ${fmt(d.traffic.errors4)} client`} />
        <Stat icon={Users} label="DAU today" value={fmt(d.users.dauToday)} tone="emerald" sub={`yesterday ${fmt(d.users.dauYesterday)} · 7d avg ${fmt(d.users.dauAvg7)}`} />
        <Stat icon={Globe2} label="Active schools" value={fmt((d.users.bySchool || []).length)} tone="violet" sub={`${fmt((d.modules || []).length)} modules touched`} />
        <Stat icon={Server} label="Uptime" value={health.uptimeSec ? `${Math.floor(health.uptimeSec / 3600)}h ${Math.floor((health.uptimeSec % 3600) / 60)}m` : '—'} tone="slate" sub={`DB ${health.dbPingMs != null ? `${health.dbPingMs} ms` : '—'} · loop ${health.eventLoopMs != null ? `${health.eventLoopMs} ms` : '—'}`} />
      </div>

      {/* ── History charts ───────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel
          title={`Requests · ${range}`}
          icon={BarChart3}
          right={<span className="text-[11px] text-slate-400">{fmt(history?.points?.reduce((s, p) => s + p.requests, 0))} total</span>}
        >
          <Spark points={history?.points} pick={(p) => p.requests} color="#7c3aed" />
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>{history?.points?.[0] ? timeLabel(history.points[0].t, range) : ''}</span>
            <span>{history?.points?.length ? timeLabel(history.points[history.points.length - 1].t, range) : ''}</span>
          </div>
        </Panel>

        <Panel
          title={`p95 latency · ${range}`}
          icon={Zap}
          right={<span className="text-[11px] text-slate-400">ms</span>}
        >
          <Spark points={history?.points} pick={(p) => p.p95} color="#0d9488" />
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>peak {Math.max(0, ...(history?.points || []).map((p) => p.p95))} ms</span>
            <span>now {d.traffic.p95} ms</span>
          </div>
        </Panel>
      </div>

      {/* ── Modules + slow routes ────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Modules · last 24 h" icon={Gauge} right={<span className="text-[11px] text-slate-400">{d.modules?.length || 0}</span>}>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400 text-[10px] uppercase tracking-wide">
                <tr><th className="text-left pb-1.5">Module</th><th className="text-right pb-1.5">Req</th><th className="text-right pb-1.5">Schools</th><th className="text-right pb-1.5">p95</th><th className="text-right pb-1.5">5xx</th></tr>
              </thead>
              <tbody>
                {(d.modules || []).map((m) => (
                  <tr key={m.module} className="border-t border-slate-50">
                    <td className="py-1.5 font-medium text-slate-700">{m.module}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(m.requests)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(m.schools)}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.p95} ms</td>
                    <td className={`py-1.5 text-right tabular-nums ${errTone(m.errorRate)}`}>{pct(m.errorRate)}</td>
                  </tr>
                ))}
                {!d.modules?.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">No module traffic captured yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Slowest route families · last hour" icon={Clock} right={<span className="text-[11px] text-slate-400">p95</span>}>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400 text-[10px] uppercase tracking-wide">
                <tr><th className="text-left pb-1.5">Route</th><th className="text-right pb-1.5">p95</th><th className="text-right pb-1.5">Req</th><th className="text-right pb-1.5">5xx</th></tr>
              </thead>
              <tbody>
                {(d.slowRoutes || []).map((r) => (
                  <tr key={r.route} className="border-t border-slate-50">
                    <td className="py-1.5 font-mono text-[10.5px] text-slate-600 truncate max-w-[210px]" title={r.route}>{r.route}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.p95} ms</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(r.requests)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${errTone(r.errorRate)}`}>{fmt(r.errors5)}</td>
                  </tr>
                ))}
                {!d.slowRoutes?.length && <tr><td colSpan={4} className="py-6 text-center text-slate-400">Nothing slow enough to rank yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* ── Schools ──────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Who is online" icon={Users} right={<span className="text-[11px] text-slate-400">last 60 s</span>}>
          {(d.users.bySchool || []).length ? (
            <ul className="space-y-2">
              {d.users.bySchool.map((s) => (
                <li key={s.schoolId} className="flex items-center justify-between text-xs">
                  <span className="text-slate-700 truncate">{s.name}</span>
                  <span className="font-semibold tabular-nums text-violet-700">{s.count}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-400 py-6 text-center">No live sessions in the last minute.</p>}
        </Panel>

        <Panel title="Busiest schools · last hour" icon={Globe2} right={<span className="text-[11px] text-slate-400">requests</span>}>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-xs">
              <tbody>
                {(d.schools || []).map((s) => (
                  <tr key={s.schoolId} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 text-slate-700 truncate max-w-[200px]">{s.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(s.requests)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-400">{s.p95} ms</td>
                    <td className={`py-1.5 text-right tabular-nums ${errTone(s.errorRate)}`}>{pct(s.errorRate)}</td>
                  </tr>
                ))}
                {!d.schools?.length && <tr><td className="py-6 text-center text-slate-400">No school traffic yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* ── Machine room ─────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Machine room" icon={Server} right={<span className="text-[11px] text-slate-400">30 s sample</span>}>
          <div className="space-y-3">
            <Meter label="Heap" value={health.heapUsedMb} max={health.heapTotalMb || 1} unit=" MB" hint={`${health.heapUsedMb ?? '—'} of ${health.heapTotalMb ?? '—'} MB · RSS ${health.rssMb ?? '—'} MB`} />
            <Meter label="Event loop p95" value={health.eventLoopMs} max={100} unit=" ms" hint="Under 50 ms is healthy; over 100 ms is a stall." />
            <Meter label="Mongo ping" value={health.dbPingMs} max={100} unit=" ms" hint={health.dbState === 1 ? 'Connected' : 'Not connected'} />
            <Meter label="Telemetry buffer" value={telemetry.bufferedRoutes} max={2000} unit=" routes" hint={`Flushed ${ago(telemetry.lastFlushAt)} in ${telemetry.lastFlushMs ?? '—'} ms · failures ${telemetry.flushFailures ?? 0}`} />
            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
              <span className="flex items-center gap-1"><Database size={11} /> {system?.db ? `${fmt(system.db.objects)} docs · ${system.db.dataSizeMb} MB` : 'DB stats pending'}</span>
              <span className={`flex items-center gap-1 ${flushAge != null && flushAge > 180 ? 'text-amber-600' : 'text-emerald-600'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${flushAge != null && flushAge > 180 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                {telemetry.enabled === false ? 'telemetry off' : flushAge == null ? 'warming up' : `flush ${flushAge}s`}
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Errors by route" icon={AlertTriangle} right={<span className="text-[11px] text-slate-400">{range}</span>}>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400 text-[10px] uppercase tracking-wide">
                <tr><th className="text-left pb-1.5">Route</th><th className="text-right pb-1.5">5xx</th><th className="text-right pb-1.5">4xx</th><th className="text-right pb-1.5">Rate</th></tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.route} className="border-t border-slate-50">
                    <td className="py-1.5 font-mono text-[10.5px] text-slate-600 truncate max-w-[210px]" title={e.route}>{e.route}</td>
                    <td className="py-1.5 text-right tabular-nums text-red-600">{fmt(e.errors5)}</td>
                    <td className="py-1.5 text-right tabular-nums text-amber-600">{fmt(e.errors4)}</td>
                    <td className="py-1.5 text-right tabular-nums">{pct(e.errorRate)}</td>
                  </tr>
                ))}
                {!errors.length && <tr><td colSpan={4} className="py-6 text-center text-slate-400">No errors in this window. Good.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <p className="text-[10px] text-slate-400 text-right">
        Generated {new Date(d.generatedAt).toLocaleTimeString()} · minute buckets {d.telemetry?.flushFailures ? `· ${d.telemetry.flushFailures} flush failure(s)` : ''}
      </p>
    </section>
  );
}
