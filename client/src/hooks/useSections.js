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

/* ── Fallback used while loading / on error ─────────────────── */
export const DEFAULT_SECTIONS = [
  { id: 'kg_default',        key: 'kg',        name: 'Kindergarten', color: '#10b981', order: 1, sectionHeadId: null, sectionHeadName: null },
  { id: 'primary_default',   key: 'primary',   name: 'Primary',      color: '#3b82f6', order: 2, sectionHeadId: null, sectionHeadName: null },
  { id: 'secondary_default', key: 'secondary', name: 'Secondary',    color: '#8b5cf6', order: 3, sectionHeadId: null, sectionHeadName: null },
  { id: 'alevel_default',    key: 'alevel',    name: 'A-Level',      color: '#f59e0b', order: 4, sectionHeadId: null, sectionHeadName: null },
];

export function useSections() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['sections'],
    queryFn:  () => sectionsApi.list(),
    staleTime: 10 * 60_000,   // 10 minutes — sections rarely change
    gcTime:    30 * 60_000,
  });

  const sections = (data?.data && data.data.length > 0)
    ? data.data
    : DEFAULT_SECTIONS;

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

  return { sections, sectionMap, sectionTabs, isLoading: isLoading && !isError };
}
