import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToast } from '@/hooks/useToast.jsx';

const STYLES = {
  success: { icon: CheckCircle,    bg: 'bg-emerald-600', ring: 'ring-emerald-500' },
  error:   { icon: XCircle,        bg: 'bg-red-600',     ring: 'ring-red-500'     },
  info:    { icon: Info,            bg: 'bg-blue-600',    ring: 'ring-blue-500'    },
  warn:    { icon: AlertTriangle,   bg: 'bg-amber-500',   ring: 'ring-amber-400'   },
};

export default function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
      <AnimatePresence initial={false}>
        {toasts.map(t => {
          const { icon: Icon, bg } = STYLES[t.type] ?? STYLES.info;
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{    opacity: 0, y: 8,  scale: 0.95, transition: { duration: 0.15 } }}
              className={`pointer-events-auto flex items-center gap-3 rounded-xl ${bg} text-white px-4 py-3 shadow-xl text-sm font-medium max-w-xs`}
            >
              <Icon size={15} className="shrink-0" />
              <span className="flex-1 leading-snug">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 opacity-70 hover:opacity-100 transition ml-1"
              >
                <X size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
