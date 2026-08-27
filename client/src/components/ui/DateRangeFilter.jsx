/**
 * DateRangeFilter — shared period selector for the main Dashboard.
 *
 * Presets: Week (7 days), Month (30 days, default), Year, Lifetime (no
 * lower bound — dateFrom omitted entirely, not just set to some far-past
 * date, so every server route that reads it treats absence as "no filter"
 * consistently).
 *
 * "Year" means the school's actual current academic year — from its
 * configured startDate through today — not a rolling 365-day window.
 * Before this fix it silently meant the latter, which on a Dashboard whose
 * whole point is leadership-facing trend numbers blended attendance, fees,
 * behaviour and grades across academic-year boundaries (including archived
 * years) with no indication anything had been mixed. Callers must pass the
 * live current year's startDate (from useCurrentAcademicPeriod) as the
 * second argument; with none available (still loading, or no academic year
 * configured yet) this falls back to the old rolling-365-day behaviour so
 * the widgets it feeds never go blank or throw while that loads.
 *
 * Visual language matches the button-group period selector this replaces
 * (Dashboard.jsx's LeadershipPanel, now driven by this shared control
 * instead of its own local state).
 */
import { useSchoolTheme } from '@/hooks/useSchoolTheme.js';

export const RANGE_PRESETS = [
  { id: 'week',     label: 'Week',     days: 7 },
  { id: 'month',    label: 'Month',    days: 30 },
  { id: 'year',     label: 'Year',     days: 365 }, // fallback length only — see computeDateRange
  { id: 'lifetime', label: 'Lifetime', days: null },
];

export const DEFAULT_RANGE = 'month';

function _todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * preset id -> { dateFrom: 'YYYY-MM-DD' | null, dateTo: 'YYYY-MM-DD' }
 *
 * @param presetId               one of RANGE_PRESETS' ids
 * @param currentYearStartDate   the live current academic year's startDate
 *                                ('YYYY-MM-DD'), when known — only consulted
 *                                for the 'year' preset.
 */
export function computeDateRange(presetId, currentYearStartDate) {
  const preset = RANGE_PRESETS.find(p => p.id === presetId) ?? RANGE_PRESETS[1];
  const dateTo = _todayStr();
  if (preset.days == null) return { dateFrom: null, dateTo };

  if (preset.id === 'year' && currentYearStartDate && currentYearStartDate <= dateTo) {
    return { dateFrom: currentYearStartDate, dateTo };
  }

  const from = new Date();
  from.setDate(from.getDate() - preset.days);
  return { dateFrom: from.toISOString().slice(0, 10), dateTo };
}

export default function DateRangeFilter({ value, onChange }) {
  const { primary } = useSchoolTheme();

  return (
    <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
      {RANGE_PRESETS.map(p => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          className={`px-3 py-1.5 text-xs rounded-md font-medium transition ${
            value === p.id ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
          style={value === p.id ? { color: primary } : {}}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
