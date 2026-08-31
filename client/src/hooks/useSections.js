/* ============================================================
   useSections — React Query hook for school curriculum sections

   Returns the school's configured sections with helper maps.
   Components import this instead of the hardcoded SECTION_LABELS
   constant so every module stays in sync when an admin renames
   or adds a section.

   Usage:
     const { sections, sectionMap, sectionTabs, isLoading } = useSections();

   sectionTabs is ready to pass to a filter-tabs component:
     [{ id:'all', label:'All Sections' }, { id:'kg', label:'Kindergarten', color:'#10b981' }, ...]
   ============================================================ */
import { useQuery } from '@tanstack/react-query';
import { sections as sectionsApi } from '@/api/client.js';

export function useSections() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sections'],
    queryFn:  () => sectionsApi.list(),
    staleTime: 10 * 60_000,   // 10 minutes — sections rarely change
    gcTime:    30 * 60_000,
  });

  // Real data only — no fabricated stand-in. This used to fall back to a
  // hardcoded Kindergarten/Primary/Secondary/A-Level list whenever `data`
  // was empty, which conflated three very different states (still
  // loading, the request failed, genuinely zero sections) into one and
  // rendered made-up section names with zero visual difference from the
  // real thing — confirmed live: a school with real, custom-named
  // sections (e.g. "KS3 Section") appeared to show a completely
  // different, generic section list for a user whose request just
  // hadn't resolved yet.
  //
  // The server-side route this calls (GET /sections) auto-seeds a
  // school's first four sections the moment it's ever queried and finds
  // none (see sections.js's own DEFAULT_SECTIONS) — so in steady state,
  // after that first request, `data.data` is never actually empty for a
  // real, successful response. An empty array here means "still
  // loading" or "the request failed," never "this school has no
  // sections." Consumers that need to tell those apart should check
  // isLoading/isError below rather than infer it from an empty array —
  // every existing consumer already degrades gracefully on an empty
  // sections array (several already gate their own render on isLoading/
  // isError for other data), so none needed changes for this.
  const sections = data?.data ?? [];

  /* { kg: { name:'Kindergarten', color:'#10b981', id:'...' }, ... } */
  const sectionMap = {};
  sections.forEach(s => { sectionMap[s.key] = s; });

  /* Ready-to-use tabs array: first entry is always "All" */
  const sectionTabs = [
    { id: 'all', label: 'All Sections', color: '#64748b' },
    // Guard: skip any section without a key (would cause undefined === undefined
    // to match every tab simultaneously when clicked).
    // color fallback prevents all tabs collapsing to the same #6366f1 purple.
    ...sections
      .filter(s => s.key)
      .map(s => ({ id: s.key, label: s.name, color: s.color || '#6366f1' })),
  ];

  return { sections, sectionMap, sectionTabs, isLoading, isError, error, refetch };
}
