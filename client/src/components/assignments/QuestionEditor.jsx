/**
 * One question in the assignment builder.
 * Keeps option ids client-side so correct answers can reference them before
 * the server normalises and stores the question.
 */
import { Library, Plus, Trash2, X } from 'lucide-react';

const uid = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `id_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);

export const QUESTION_TYPE_LABEL = {
  MCQ_SINGLE: 'Single choice',
  MCQ_MULTI: 'Multiple choice',
  SHORT_TEXT: 'Short answer',
  LONG_TEXT: 'Long answer',
  FILE: 'File upload',
};

export function emptyQuestion() {
  return {
    id: uid(),
    type: 'MCQ_SINGLE',
    prompt: '',
    points: '1',
    options: [{ id: uid(), text: '' }, { id: uid(), text: '' }],
    correctOptionIds: [],
  };
}

export { uid };

export default function QuestionEditor({ index, question, onChange, onRemove, onSaveToBank }) {
  const isMcq = ['MCQ_SINGLE', 'MCQ_MULTI'].includes(question.type);

  const setOption = (optId, text) =>
    onChange({ options: question.options.map(o => (o.id === optId ? { ...o, text } : o)) });

  function toggleCorrect(optId) {
    if (question.type === 'MCQ_SINGLE') {
      onChange({ correctOptionIds: [optId] });
      return;
    }
    const has = question.correctOptionIds.includes(optId);
    onChange({
      correctOptionIds: has
        ? question.correctOptionIds.filter(id => id !== optId)
        : [...question.correctOptionIds, optId],
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center">
          {index + 1}
        </span>
        <select
          value={question.type}
          onChange={e => onChange({ type: e.target.value, correctOptionIds: [] })}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
        >
          {Object.entries(QUESTION_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <input
            type="number" min="1" value={question.points}
            onChange={e => onChange({ points: e.target.value })}
            title="Points"
            className="w-16 text-xs border border-slate-200 rounded-lg px-2 py-1.5"
          />
          <span className="text-[10px] text-slate-400">pts</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onSaveToBank}
            className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-indigo-600"
          >
            <Library size={11} /> Bank
          </button>
          <button type="button" onClick={onRemove} className="text-slate-300 hover:text-red-500 p-1">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <input
        value={question.prompt}
        onChange={e => onChange({ prompt: e.target.value })}
        placeholder="Question prompt"
        className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      />

      {isMcq && (
        <div className="space-y-1.5">
          {question.options.map(opt => (
            <div key={opt.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleCorrect(opt.id)}
                className={`w-4 h-4 shrink-0 rounded-full border flex items-center justify-center ${
                  question.correctOptionIds.includes(opt.id)
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-slate-300 bg-white'
                }`}
                title="Mark as correct"
              >
                {question.correctOptionIds.includes(opt.id) && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </button>
              <input
                value={opt.text}
                onChange={e => setOption(opt.id, e.target.value)}
                placeholder="Option text"
                className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <button type="button" onClick={() => onChange({
                options: question.options.filter(o => o.id !== opt.id),
                correctOptionIds: question.correctOptionIds.filter(id => id !== opt.id),
              })} className="text-slate-300 hover:text-red-500">
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ options: [...question.options, { id: uid(), text: '' }] })}
            className="text-[10px] font-semibold text-indigo-600 hover:underline"
          >
            + Add option
          </button>
        </div>
      )}

      {!isMcq && (
        <p className="text-[10px] text-slate-400">
          {question.type === 'FILE' ? 'Student uploads a file for this question.' : 'Student types an answer; you mark it.'}
        </p>
      )}
    </div>
  );
}
