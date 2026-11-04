/* ============================================================
   TrendsCard — the time-series view of the same numbers the tabs show.

   GET /api/analytics/series returns attendance / billed / collected / marks
   as four arrays sharing ONE gap-free x-axis ("a week with no register read
   still occupies its slot"), so this card switches metric without ever
   re-querying and never draws a straight line over a hole.

   Two honesty rules from the server are carried through here:
     • a bucket with no register read has rate: null, not 0% — shown as a gap;
     • when the axis had to be truncated (meta.truncatedFrom), the card says
       so rather than presenting a clipped window as the whole story.
   ============================================================ */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { analytics as analyticsApi } from '@/api/client.js';
import { Card, ChartTip, COLORS } from './ReportsPrimitives.jsx';

const RANGES = [
  { id: 30,  label: '30 days' },
  { id: 90,  label: '90 days' },
  { id: 365, label: '1 year' },
];

const METRICS = [
  { id: 'attendance', label: 'Attendance', unit: '%' },
  { id: 'billed',     label: 'Billed',     money: true },
  { id: 'collected',  label: 'Collected',  money: true },
  { id: 'marks',      label: 'Marks filed' },
  // The same marks series the API returns carries the average they were filed
  // at, which is the academic trend — the count alone says how busy the week
  // was, not how it went.
  { id: 'avgScore',   label: 'Average score', score: true },
];

function _isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function _bucketLabel(key, bucket) {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  const monthName = new Date(`${key}T00:00:00Z`).toLocaleString('en-US', { month: 'short' });
  if (bucket === 'month') return `${monthName} ${y}`;
  return `${monthName} ${Number(d)}`;
}

/** A window edge ('YYYY-MM-DD') as a plain date, for the caption under the axis. */
function _isoday(key) {
  if (!key) return '';
  const d = new Date(`${String(key).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(key);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function _formatMoney(value, sym) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${sym} ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${sym} ${(n / 1_000).toFixed(0)}K`;
  return `${sym} ${n.toLocaleString()}`;
}

export default function TrendsCard({ sym = 'KSh', enabled = true }) {
  const [rangeDays, setRangeDays] = useState(90);
  const [metric, setMetric] = useState('attendance');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['analytics', 'series', rangeDays],
    queryFn: () => analyticsApi.series({ dateFrom: _isoDaysAgo(rangeDays) }),
    enabled,
    staleTime: 2 * 60_000,
    select: r => r?.data ?? r,
  });

  const meta = data?.meta ?? null;
  const bucket = meta?.bucket ?? 'day';

  const chartData = useMemo(() => {
    const attendance = data?.attendance ?? [];
    const billed = data?.billed ?? [];
    const collected = data?.collected ?? [];
    const marks = data?.marks ?? [];
    // All four arrays are the same length and share the x-axis; the labels
    // come from the attendance array's bucket keys (the others mirror them).
    return attendance.map((point, i) => ({
      label: _bucketLabel(point.bucket, bucket),
      attendance: point.rate,
      // The API also states the denominator behind each rate — carried through
      // so the tooltip can say "83% (176 of 212)" instead of a bare number.
      attPresent: point.present ?? 0,
      attTotal: point.total ?? 0,
      billed: billed[i]?.amount ?? 0,
      collected: collected[i]?.amount ?? 0,
      marks: marks[i]?.marksCount ?? 0,
      // null (not 0) when nothing was marked that bucket: an empty week has no
      // average, and the chart draws the gap rather than a plunge to zero.
      avgScore: marks[i]?.avgScore ?? null,
    }));
  }, [data, bucket]);

  const totals = useMemo(() => {
    const billed = (data?.billed ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
    const collected = (data?.collected ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
    const marks = (data?.marks ?? []).reduce((s, p) => s + (p.marksCount ?? 0), 0);
    const rated = (data?.attendance ?? []).filter(p => typeof p.rate === 'number');
    const avgAttendance = rated.length
      ? Math.round((rated.reduce((s, p) => s + p.rate, 0) / rated.length) * 10) / 10
      : null;
    /* Marks-weighted, exactly as the server folds its buckets: a heavy week of
       one student's work must not count for as much as a light week of many. */
    const scoreSum = (data?.marks ?? []).reduce(
      (s, p) => s + (typeof p.avgScore === 'number' ? p.avgScore * (p.marksCount ?? 0) : 0), 0);
    const scoreCount = (data?.marks ?? []).reduce(
      (s, p) => s + (typeof p.avgScore === 'number' ? (p.marksCount ?? 0) : 0), 0);
    const avgScore = scoreCount ? Math.round((scoreSum / scoreCount) * 10) / 10 : null;
    return { billed, collected, marks, avgAttendance, avgScore };
  }, [data]);

  const value = m => {
    if (m.id === 'attendance') {
      return totals.avgAttendance == null ? '—' : `${totals.avgAttendance}%`;
    }
    if (m.id === 'billed' || m.id === 'collected') {
      return _formatMoney(m.id === 'billed' ? totals.billed : totals.collected, sym);
    }
    if (m.id === 'avgScore') {
      return totals.avgScore == null ? '—' : `${totals.avgScore}%`;
    }
    return totals.marks.toLocaleString();
  };

  /* One formatter per metric, so the tooltip says the same thing the axis and
     the headline do: money in the school's currency, rates as percentages,
     and the attendance rate with its own denominator behind it. */
  const tipFormat = (v, entry) => {
    if (v == null) return '—';
    if (active.id === 'attendance') {
      const { attPresent, attTotal } = entry?.payload ?? {};
      return attTotal ? `${v}% (${attPresent} of ${attTotal} present)` : `${v}%`;
    }
    if (active.money) return _formatMoney(v, sym);
    if (active.score) return `${v}%`;
    return `${v} ${v === 1 ? 'mark' : 'marks'}`;
  };

  const active = METRICS.find(m => m.id === metric) ?? METRICS[0];
  const hasPoints = chartData.length > 0;

  return (
    <Card
      title="School Trends"
      action={
        <div className="flex items-center gap-1 rounded-lg bg-slate-100/80 p-0.5">
          {RANGES.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRangeDays(r.id)}
              className={clsx(
                'rounded-md px-2 py-1 text-[11px] font-semibold transition',
                rangeDays === r.id ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      {/* Metric switcher + the window's headline number */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {METRICS.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMetric(m.id)}
            className={clsx(
              'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
              metric === m.id
                ? 'border-violet-300 bg-violet-50 text-violet-700'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {m.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">
          {(active.id === 'attendance' || active.score) ? 'Average in window:' : 'Total in window:'}{' '}
          <strong className="text-slate-800">{value(active)}</strong>
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 size={15} className="animate-spin" /> Loading trends…
        </div>
      ) : isError ? (
        <p className="py-16 text-center text-sm text-slate-400">
          {error?.message || 'Trend data is not available right now.'}
        </p>
      ) : !hasPoints ? (
        <p className="py-16 text-center text-sm text-slate-400">
          No activity in this window yet — mark attendance, raise an invoice or file marks to see a trend.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            {(metric === 'attendance' || metric === 'avgScore') ? (
              <AreaChart data={chartData} margin={{ left: -10, right: 8 }}>
                <defs>
                  <linearGradient id="trendAttendance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={metric === 'avgScore' ? COLORS[0] : COLORS[1]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={metric === 'avgScore' ? COLORS[0] : COLORS[1]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                {/* Both rates are 0-100; a fixed domain keeps two windows
                    visually comparable instead of rescaling to the min/max. */}
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                <Tooltip content={<ChartTip format={tipFormat} />} />
                <Area
                  type="monotone"
                  dataKey={metric}
                  name={metric === 'avgScore' ? 'Average score %' : 'Attendance %'}
                  stroke={metric === 'avgScore' ? COLORS[0] : COLORS[1]}
                  strokeWidth={2}
                  fill="url(#trendAttendance)"
                  connectNulls={false}
                />
              </AreaChart>
            ) : (
              <BarChart data={chartData} margin={{ left: -10, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={v => (active.money ? _formatMoney(v, sym) : v)}
                />
                <Tooltip content={<ChartTip format={tipFormat} />} />
                <Bar
                  dataKey={metric}
                  name={active.label}
                  fill={metric === 'collected' ? COLORS[2] : metric === 'billed' ? COLORS[0] : COLORS[3] ?? '#8b5cf6'}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            )}
          </ResponsiveContainer>

          {/* What the axis is really showing */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-[10px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Info size={10} />
              {bucket === 'day' ? 'One point per day' : bucket === 'week' ? 'One point per week' : 'One point per month'}
              {meta?.requested ? '' : ' (chosen from the window)'} · {chartData.length} points
            </span>
            {/* The window the server actually resolved — asked for as "90 days",
                reported as the two dates the buckets cover. */}
            {meta?.since && meta?.until && (
              <span>{_isoday(meta.since)} → {_isoday(meta.until)}</span>
            )}
            {meta?.truncatedFrom && (
              <span className="inline-flex items-center gap-1 text-amber-600">
                <AlertTriangle size={10} />
                Earlier buckets were trimmed — this window starts {_bucketLabel(meta.truncatedFrom, bucket)}
              </span>
            )}
            {metric === 'attendance' && (
              <span>A gap means no register was marked — it is not 0%.</span>
            )}
            {metric === 'avgScore' && (
              <span>A gap means no marks were filed that period — it is not 0%.</span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
