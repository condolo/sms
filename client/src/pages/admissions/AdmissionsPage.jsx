/* ============================================================
   AdmissionsPage — kanban pipeline shell (was 1115 lines)
   Decomposed into: constants.js + AdmissionsPrimitives +
   KanbanBoard · ListView · AddSlideOver · StageModal · DetailPanel
   ============================================================ */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { UserPlus, Search, X, Download, Users, TrendingUp, Clock, Star } from 'lucide-react';
import { admissions as admissionsApi } from '@/api/client.js';
import { PIPELINE, exportAdmissionsCSV } from './constants.js';
import { StatChip } from './components/AdmissionsPrimitives.jsx';
import KanbanBoard  from './components/KanbanBoard.jsx';
import ListView     from './components/ListView.jsx';
import AddSlideOver from './components/AddSlideOver.jsx';
import StageModal   from './components/StageModal.jsx';
import DetailPanel  from './components/DetailPanel.jsx';

export default function AdmissionsPage() {
  const qc = useQueryClient();

  /* UI state */
  const [search, setSearch]           = useState('');
  const [viewMode, setViewMode]       = useState('kanban');   // 'kanban' | 'list'
  const [showAdd, setShowAdd]         = useState(false);
  const [stageModal, setStageModal]   = useState(null);       // applicant obj
  const [detailPanel, setDetailPanel] = useState(null);       // applicant obj

  /* Stats */
  const { data: statsRes } = useQuery({
    queryKey: ['admissions', 'stats'],
    queryFn:  () => admissionsApi.stats(),
    staleTime: 60_000,
  });
  const byStageArr   = statsRes?.data?.byStage ?? [];
  const statsByStage = Object.fromEntries(byStageArr.map(s => [s.stage, s]));

  /* One query per active pipeline stage (hooks in loop — intentional) */
  const stageQueries = PIPELINE.map(col =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ['admissions', 'stage', col.id, search],
      queryFn:  () => admissionsApi.list({ stage: col.id, search: search || undefined, limit: 200, page: 1 }),
      staleTime: 30_000,
      select: r => r?.data ?? [],
    })
  );

  const kanbanCols = PIPELINE.map((col, i) => ({
    ...col,
    items:     stageQueries[i].data ?? [],
    isLoading: stageQueries[i].isLoading,
  }));

  const totalApplications = statsRes?.data?.total ?? byStageArr.reduce((a, s) => a + (s.count ?? 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-2xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Admissions Pipeline</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {totalApplications} total applicant{totalApplications !== 1 ? 's' : ''} across all stages
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                {[['kanban', 'Board'], ['list', 'List']].map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => exportAdmissionsCSV(kanbanCols)}
                className="flex items-center gap-1.5 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-sm font-medium px-3 py-2 rounded-lg transition-colors"
                title="Export applicants CSV"
              >
                <Download size={14} />
                Export
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <UserPlus size={15} />
                New Application
              </button>
            </div>
          </div>

          {/* Stats strip */}
          <div className="flex items-center gap-6 mt-5 pt-4 border-t border-slate-100 overflow-x-auto pb-1">
            <StatChip icon={<Users size={14} />}      label="Total"    value={totalApplications} />
            <StatChip icon={<TrendingUp size={14} />} label="Enrolled" value={statsByStage['enrolled']?.count ?? 0}  accent="emerald" />
            <StatChip icon={<Clock size={14} />}      label="Pending"  value={(statsByStage['enquiry']?.count ?? 0) + (statsByStage['application']?.count ?? 0)} accent="blue" />
            <StatChip icon={<Star size={14} />}       label="High Pri" value={Object.values(statsByStage).reduce((a, s) => a + (s.highPriority ?? 0), 0)} accent="amber" />
          </div>
        </div>
      </div>

      {/* ── Search bar ──────────────────────────────────────── */}
      <div className="px-6 py-3 bg-white border-b border-slate-100">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search applicants…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        {viewMode === 'kanban'
          ? <KanbanBoard cols={kanbanCols} onCardClick={setDetailPanel} onStageClick={setStageModal} />
          : <ListView    cols={kanbanCols} onCardClick={setDetailPanel} onStageClick={setStageModal} />
        }
      </div>

      {/* ── Overlays ────────────────────────────────────────── */}
      <AnimatePresence>
        {showAdd && (
          <AddSlideOver
            onClose={() => setShowAdd(false)}
            onCreated={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['admissions'] }); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {stageModal && (
          <StageModal
            applicant={stageModal}
            onClose={() => setStageModal(null)}
            onChanged={() => { setStageModal(null); qc.invalidateQueries({ queryKey: ['admissions'] }); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {detailPanel && (
          <DetailPanel
            applicant={detailPanel}
            onClose={() => setDetailPanel(null)}
            onStageChange={() => { setStageModal(detailPanel); setDetailPanel(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
