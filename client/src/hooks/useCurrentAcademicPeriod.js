/* ============================================================
   useCurrentAcademicPeriod — React Query hook for the live
   current academic year + term.

   Single source of truth for defaulting year/term pickers.
   Backed by GET /api/academic-config/current, which resolves
   "now" against the school's configured year/term date ranges
   server-side (server/routes/academic-config.js: _resolveCurrentPeriod).

   Components must use this instead of reimplementing
   years.find(y => y.isCurrent) or a date-range scan locally —
   that duplication is exactly what caused year/term defaults to
   drift out of sync across admissions, exam creation, and report
   cards before this hook existed.

   Usage:
     const { academicYearId, termId, termNumber, isLoading } = useCurrentAcademicPeriod();
   ============================================================ */
import { useQuery } from '@tanstack/react-query';
import { academicConfig as academicConfigApi } from '@/api/client.js';

export function useCurrentAcademicPeriod() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['academic-config', 'current'],
    queryFn:  () => academicConfigApi.current(),
    staleTime: 5 * 60_000,   // re-check every 5 min — term boundaries are date-driven, not user-driven
    gcTime:    30 * 60_000,
  });

  const cur = data?.data ?? {};

  return {
    academicYearId: cur.academicYearId ?? null,
    academicYear:   cur.academicYear   ?? null,
    termId:         cur.termId         ?? null,
    termName:       cur.termName       ?? null,
    termNumber:     cur.termNumber     ?? null,
    year:           cur.year           ?? null,
    term:           cur.term           ?? null,
    isLoading: isLoading && !isError,
  };
}
