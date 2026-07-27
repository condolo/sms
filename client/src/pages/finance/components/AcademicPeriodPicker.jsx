/* ============================================================
   AcademicPeriodPicker — dependent Academic Year → Term selects,
   backed by the school's real academic_years records. Mirrors the
   picker pattern in exams/ExamsPage.jsx's CreateExamSlideOver so
   Finance resolves the same way Exams/Report Cards already do,
   instead of the free-text year/fixed-term-number fields it used
   to have.

   Props:
     academicYearId, termId  — current selection ('' = unset)
     onChange({academicYearId, termId})
     includeAllOption  bool — renders "All years"/"All terms" as the
                              empty option, for filter-bar usage
     compact           bool — bare selects with no label, for a
                              toolbar; default renders labeled fields
                              for a form
   ============================================================ */
import { useQuery } from '@tanstack/react-query';
import { academicConfig as academicConfigApi } from '@/api/client.js';

export default function AcademicPeriodPicker({ academicYearId, termId, onChange, includeAllOption = false, compact = false, className = '' }) {
  const { data: yearsData } = useQuery({
    queryKey: ['academic-config', 'years'],
    queryFn:  academicConfigApi.years.list,
    staleTime: 10 * 60_000,
  });
  const years = yearsData?.data ?? yearsData ?? [];
  const selectedYear = years.find(y => (y.id ?? y._id?.toString()) === academicYearId);
  const yearTerms = selectedYear?.terms ?? [];

  function handleYearChange(yearId) {
    onChange({ academicYearId: yearId, termId: '' });
  }
  function handleTermChange(tId) {
    onChange({ academicYearId, termId: tId });
  }

  const selCls = compact
    ? 'text-sm px-3 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700'
    : 'w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10';

  const yearSelect = (
    <select value={academicYearId || ''} onChange={e => handleYearChange(e.target.value)} className={selCls}>
      <option value="">{includeAllOption ? 'All years' : 'Select year…'}</option>
      {years.map(y => <option key={y.id ?? y._id} value={y.id ?? y._id}>{y.name}{y.isCurrent ? ' (Current)' : ''}</option>)}
    </select>
  );
  const termSelect = (
    <select
      value={termId || ''}
      onChange={e => handleTermChange(e.target.value)}
      disabled={!academicYearId || yearTerms.length === 0}
      className={selCls}
    >
      <option value="">
        {!academicYearId ? (includeAllOption ? 'All terms' : 'Select year first')
          : yearTerms.length === 0 ? 'No terms configured'
          : (includeAllOption ? 'All terms' : 'Select term…')}
      </option>
      {yearTerms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );

  if (compact) {
    return (
      <>
        {yearSelect}
        {termSelect}
      </>
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-3 ${className}`}>
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1.5">Academic Year</label>
        {yearSelect}
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1.5">Term</label>
        {termSelect}
      </div>
    </div>
  );
}
