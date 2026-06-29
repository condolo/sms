import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, CheckCircle, ChevronRight, X } from 'lucide-react';
import { MODULE_PREVIEWS, ECOSYSTEM_NODES } from '@/data/landingData';
import { storeSchoolSlug } from '@/utils/schoolDetect.js';
import ModuleMockup from './ModuleMockup';

function _textColor(bgClass) {
  return bgClass.replace('bg-', 'text-').replace(/-\d{3}$/, '-400');
}
function _lightBg(bgClass) {
  return bgClass.replace(/-\d{3}$/, '-900/30');
}

function PanelContent({ node, preview, demoUrl, onClose, onNavigate }) {
  function openDemo(e) {
    e.preventDefault();
    storeSchoolSlug('demo');
    window.open(demoUrl, '_blank', 'noopener,noreferrer');
  }

  const connectedNodes = (preview.connectedModules || [])
    .map(label => ECOSYSTEM_NODES.find(n => n.label === label))
    .filter(Boolean)
    .slice(0, 5);

  const textColor = _textColor(node.color);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-800 shrink-0">
        <div className={`w-10 h-10 rounded-xl ${node.color} flex items-center justify-center shadow-lg shrink-0 mt-0.5`}>
          <node.Icon size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-white leading-tight">{node.label}</h3>
            {preview.badge && (
              <span className="inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 whitespace-nowrap">
                {preview.badge}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 leading-snug mt-0.5">{preview.tagline}</p>
        </div>
        <button onClick={onClose}
          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors shrink-0 mt-0.5">
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">What you get</p>
          <ul className="space-y-2.5">
            {preview.outcomes.map((outcome, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <div className={`w-4 h-4 rounded-full ${node.color} flex items-center justify-center shrink-0 mt-0.5`}>
                  <CheckCircle size={8} className="text-white" />
                </div>
                <span className="text-sm text-slate-300 leading-snug">{outcome}</span>
              </li>
            ))}
          </ul>
        </div>

        {preview.results?.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Result</p>
            <ul className="space-y-2">
              {preview.results.map((r, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <CheckCircle size={13} className={`shrink-0 mt-0.5 ${textColor}`} />
                  <span className="text-sm text-slate-300 leading-snug">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Module preview</p>
          <ModuleMockup mockup={preview.mockup} color={node.color} />
        </div>

        {connectedNodes.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Connected Modules</p>
            <div className="flex flex-wrap gap-2">
              {connectedNodes.map(cn => (
                <button key={cn.label} onClick={() => onNavigate && onNavigate(cn)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 transition-colors group">
                  <div className={`w-5 h-5 rounded-lg ${cn.color} flex items-center justify-center shrink-0`}>
                    <cn.Icon size={10} className="text-white" />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400 group-hover:text-white transition-colors">
                    {cn.label}
                  </span>
                  <ChevronRight size={10} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-600 mt-2">Click any module to explore it</p>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div className="px-5 py-4 border-t border-slate-800 shrink-0 bg-slate-950 space-y-2.5">
        <button onClick={openDemo}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-900/40 active:scale-[0.98]">
          Open Live Demo
          <ArrowRight size={14} />
        </button>
        <a href="/contact"
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-slate-400 hover:text-white border border-slate-800 hover:border-slate-600 rounded-xl transition-all">
          Explore {node.label} in depth →
        </a>
        <p className="text-[10px] text-slate-600 text-center">Demo opens in your browser — no sign-up required</p>
      </div>
    </div>
  );
}

export default function ModulePreviewPanel({ node, onClose, onNavigate }) {
  const preview = MODULE_PREVIEWS[node?.label];
  if (!node || !preview) return null;

  const demoUrl = `https://demo.msingi.io${preview.demoPath}`;

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-end sm:items-stretch justify-end">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Desktop — slides from right */}
        <motion.div
          initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 350 }}
          className="relative z-10 hidden sm:flex flex-col bg-slate-950 border-l border-slate-800 w-[440px] h-full overflow-y-auto">
          <PanelContent node={node} preview={preview} demoUrl={demoUrl} onClose={onClose} onNavigate={onNavigate} />
        </motion.div>

        {/* Mobile — bottom sheet */}
        <motion.div
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 350 }}
          className="relative z-10 sm:hidden flex flex-col bg-slate-950 border-t border-slate-800 w-full max-h-[88vh] rounded-t-3xl overflow-y-auto">
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-slate-700" />
          </div>
          <PanelContent node={node} preview={preview} demoUrl={demoUrl} onClose={onClose} onNavigate={onNavigate} />
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
