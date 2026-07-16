// Shared drawer shell: a right-side sheet on desktop, a bottom sheet on
// phones. The responsive counterpart to Modal (centered dialogs) — used by
// Customize Session, the mobile More menu, and future explainer/help panels.
// Provides the same accessibility contract as Modal: role=dialog semantics,
// focus moved in on open and restored on close, Tab trapped inside, Escape
// and backdrop-tap to close (an open ThemedSelect inside still consumes
// Escape first). The body scrolls internally; the header (title + Done) stays
// pinned; safe-area insets are respected on phones.

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Drawer({ label, onClose, children, testId }: {
  label: string; // accessible name + visible header title
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if ((e.target as HTMLElement | null)?.closest?.('[data-dropdown-open="true"]')) return;
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
    <div data-testid={testId} onClick={() => onCloseRef.current()}
      className="fixed inset-0 z-[130] bg-foreground/30 backdrop-blur-sm">
      <div ref={cardRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-3xl border border-border bg-card shadow-2xl outline-none
          sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-96 sm:rounded-l-3xl sm:rounded-tr-none sm:border-y-0 sm:border-r-0">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-lg font-semibold">{label}</h2>
          <button onClick={() => onCloseRef.current()}
            className="flex min-h-[2.5rem] items-center gap-1.5 rounded-full border border-border bg-card px-4 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
            Done <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
          {children}
        </div>
      </div>
    </div>
  );
}

// Small labeled section inside a drawer.
export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{title}</h3>
      <div className="mt-1.5 space-y-0.5">{children}</div>
    </section>
  );
}

// One settings row: label + hint on the left, a control (toggle/button) on
// the right. Rows stay ≥44px tall for touch.
export function DrawerRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[2.75rem] items-center justify-between gap-3 rounded-xl px-1 py-2">
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </div>
  );
}
