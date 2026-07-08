// Accessible dialog shell shared by every modal in the app. Provides what the
// bare <div> overlays were missing: role="dialog" + aria-modal semantics,
// focus moved into the dialog on open and restored on close, Tab/Shift-Tab
// trapped inside, and Escape to close. Backdrop tap closes unless
// backdropClose is false (e.g. the tutorial, where a stray tap must not eat
// the tour).

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ label, onClose, children, cardClassName, overlayClassName, backdropClose = true, testId }: {
  label: string; // accessible name announced by screen readers
  onClose: () => void; // Escape (and backdrop tap when enabled) call this
  children: ReactNode;
  cardClassName: string;
  overlayClassName?: string;
  backdropClose?: boolean;
  testId?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    // Capture phase so Escape closes the top-most dialog instead of reaching
    // listeners behind it (like the focus-mode overlay's own Escape handler).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) { e.preventDefault(); return; }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === cardRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div data-testid={testId} onClick={backdropClose ? () => onCloseRef.current() : undefined}
      className={overlayClassName ?? "fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm"}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className={`outline-none ${cardClassName}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
