/* ============================================================
   ui/Dialog — accessible dialog behavior, shared by every modal
   ------------------------------------------------------------
   Before this primitive each messaging modal hand-rolled its
   overlay: none trapped focus (Tab escaped into the page behind),
   none closed on Escape, none locked page scroll, and none gave
   back focus to the button that opened them. Screen-reader and
   keyboard users got a different experience per modal.

   Two exports:
   • useDialogBehavior(open, onClose) — the behavior half, for
     surfaces that keep custom markup/animations (the compose
     slide-over): Escape, scroll lock, focus restore.
   • Dialog — the full primitive (portal + role="dialog" +
     focus trap + initial focus) for centered modals.

   Focus return deliberately does NOT run when the dialog closes
   because its trigger unmounted with it — restoring focus to a
   detached node would fall back to <body> anyway.
   ============================================================ */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** First focusable inside a container (or the container itself). */
function focusFirst(container) {
  const target = container?.querySelector('[data-autofocus]') || container?.querySelector(FOCUSABLE);
  if (target && typeof target.focus === 'function') {
    target.focus();
    return;
  }
  container?.focus?.();
}

/** Escape-to-close, body scroll lock, focus restore, and — when a
 *  containerRef is passed — initial focus inside the dialog. Without
 *  the initial move keyboard focus stays on the page behind and the
 *  Tab trap only catches up on the second keypress. */
export function useDialogBehavior(open, onClose, containerRef = null) {
  const restoreTo = useRef(null);
  /* Keep the latest onClose without re-running the open effect — otherwise
     every re-render while open re-captures document.activeElement, and
     focus returns to whatever the user last clicked inside the dialog
     instead of the trigger that opened it. */
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
      }
    };
    document.addEventListener('keydown', onKey);

    /* Deferred a tick so the dialog's own content is mounted (portals and
       motion wrappers mount after this effect runs). */
    const focusTimer = setTimeout(() => {
      const node = containerRef?.current;
      if (node && !node.contains(document.activeElement)) focusFirst(node);
    }, 0);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      const node = restoreTo.current;
      if (node && node.isConnected && typeof node.focus === 'function') node.focus();
    };
    // Runs on the open/close transition only; onClose rides in the ref.
  }, [open]);
}

/** Keep Tab cycling inside `container` (call from onKeyDown). */
export function trapTabKey(e, container) {
  if (e.key !== 'Tab' || !container) return;
  const nodes = [...container.querySelectorAll(FOCUSABLE)]
    .filter(el => el.offsetParent !== null || el === document.activeElement);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Centered modal dialog. Renders nothing when closed.
 * `labelledBy` should point at the dialog's heading id — prefer that
 * over `label` so the accessible name matches the visible title.
 */
export default function Dialog({ open, onClose, labelledBy, label, className = '', children }) {
  const ref = useRef(null);
  useDialogBehavior(open, onClose, ref);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : (label || undefined)}
      tabIndex={-1}
      className={className}
      onKeyDown={e => trapTabKey(e, ref.current)}
    >
      {children}
    </div>,
    document.body,
  );
}
