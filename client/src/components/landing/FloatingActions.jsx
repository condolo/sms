import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, MessageCircle } from 'lucide-react';
import { useWaUrl } from '@/hooks/useWaUrl';

export default function FloatingActions() {
  const waUrl    = useWaUrl();
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    function onScroll() { setShowTop(window.scrollY > 400); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {showTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Back to top"
            className="w-10 h-10 rounded-full bg-white border border-slate-200 shadow-md flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all">
            <ArrowUp size={16} />
          </motion.button>
        )}
      </AnimatePresence>
      <a href={waUrl} target="_blank" rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        className="w-12 h-12 rounded-full bg-[#25D366] flex items-center justify-center shadow-lg shadow-green-500/30 hover:scale-110 transition-all">
        <MessageCircle size={22} className="text-white" />
      </a>
    </div>
  );
}
