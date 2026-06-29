/* ============================================================
   Global toast system — context + hook
   Usage:
     const { toast } = useToast();
     toast.success('Saved.');
     toast.error('Something went wrong.');
     toast.info('Note: ...');
     toast.warn('Warning: ...');
   ============================================================ */
import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';

const ToastContext = createContext(null);

let _nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const push = useCallback((type, message, duration = 5000) => {
    const id = _nextId++;
    setToasts(prev => [...prev.slice(-3), { id, type, message }]); // max 4 stacked
    timers.current[id] = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      delete timers.current[id];
    }, duration);
  }, []);

  const dismiss = useCallback(id => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Stable reference — only recreated when push changes (which is never after mount)
  const toast = useMemo(() => ({
    success: (msg, dur) => push('success', msg, dur),
    error:   (msg, dur) => push('error',   msg, dur),
    info:    (msg, dur) => push('info',    msg, dur),
    warn:    (msg, dur) => push('warn',    msg, dur),
  }), [push]);

  // Stable value object — only consumers that use `toasts` (the Toaster) re-render on each add/dismiss
  const value = useMemo(() => ({ toast, toasts, dismiss }), [toast, toasts, dismiss]);

  // Clear all pending timers if the provider ever unmounts
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
