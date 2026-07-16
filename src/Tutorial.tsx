// First-run tour: quick cards that walk a new user through the app. Each step
// switches to the real tab it describes AND spotlights the actual section on
// screen — the section is scrolled into the space ABOVE a compact bottom card
// and ringed, so the highlight and the explanation never overlap. Finishing or
// skipping sets a localStorage flag; the header "?" button and the profile
// menu's "App tour" row bring it back anytime. Steps without a target (or whose
// target isn't on screen) just dim the screen, so the tour never breaks.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Timer, ListChecks, Smartphone, Users, BarChart3, type LucideIcon } from "lucide-react";
import type { View } from "./App";
import { track } from "./track";
import { savePref } from "./storage";

export const TUTORIAL_SEEN_KEY = "roamly-tutorial-seen";

// `target` is a CSS selector for the section to spotlight on that step; steps
// without one (e.g. the install tip, kept last) just dim the screen.
const STEPS: { view: View; icon: LucideIcon; title: string; body: string; target?: string }[] = [
  {
    view: "focus", icon: Timer, title: "Welcome to Roamly", target: '[data-tour="timer"]',
    body: "This is your study timer. Tap “Select timer” to pick a rhythm, like 25 minutes of focus then a 5-minute break, and hit Start. Roamly runs the cycles for you.",
  },
  {
    view: "tasks", icon: ListChecks, title: "Queue your studying", target: '[data-tour="tasks"]',
    body: "Add tasks by subject and tick them off as you finish. Premium members can even upload lecture notes and let AI write the task list.",
  },
  {
    view: "rooms", icon: Users, title: "Study together", target: '[data-tour="rooms"]',
    body: "Every room's timer is already running. Hit Join to drop in, focus in silence alongside everyone, then chat and voice open at each break.",
  },
  {
    view: "analytics", icon: BarChart3, title: "Watch it add up", target: '[data-tour="analytics"]',
    body: "Every session lands here: your daily goal, streak, subject breakdown, and achievements. Replay this tour anytime from the ? button up top.",
  },
  {
    view: "focus", icon: Smartphone, title: "Add Roamly to your Home Screen",
    body: "On iPhone: tap Safari's Share button, then “Add to Home Screen”. On Android or desktop: open the browser menu, then “Install app”. Roamly then opens full-screen like a real app, with its own icon.",
  },
];

const TOP_MARGIN = 64; // space kept above the highlighted section
const CARD_GAP = 14; // gap between the spotlight and the card

export function Tutorial({ setView, onClose }: { setView: (v: View) => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardH, setCardH] = useState(260);
  const cardRef = useRef<HTMLDivElement>(null);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const Icon = s.icon;

  const finish = () => {
    track("tutorial_done");
    savePref(TUTORIAL_SEEN_KEY, "1");
    setView("focus");
    onClose();
  };

  // Measure the card so the spotlight can be clamped to the area above it.
  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [step]);

  // Switch to the step's tab, then find its section, scroll it just below the
  // top edge (into the space above the card), and measure it. The target may
  // not be mounted the instant the tab switches, so poll a few frames.
  useEffect(() => {
    setView(s.view);
    setRect(null);
    if (!s.target) return;
    const selector = s.target;
    let raf = 0;
    let tries = 0;
    let settle = 0;
    const locate = () => {
      const el = document.querySelector(selector);
      if (el) {
        // Center the section (or, if it's taller than the space above the
        // card, its top portion) in the zone between the top margin and the
        // card, so it stays fully visible and never hides behind the card.
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const zoneBottom = vh - (cardRef.current?.offsetHeight ?? cardH) - CARD_GAP;
        const zoneCenter = (TOP_MARGIN + zoneBottom) / 2;
        const shownHeight = Math.min(r.height, Math.max(60, zoneBottom - TOP_MARGIN));
        const delta = (r.top + shownHeight / 2) - zoneCenter;
        window.scrollBy({ top: delta, behavior: "smooth" });
        settle = window.setTimeout(() => setRect(el.getBoundingClientRect()), 340);
      } else if (tries++ < 30) {
        raf = requestAnimationFrame(locate);
      }
    };
    raf = requestAnimationFrame(locate);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(settle); };
  }, [step, s.view, s.target, setView]);

  // Keep the spotlight aligned while the page scrolls or resizes.
  useEffect(() => {
    if (!s.target) return;
    const selector = s.target;
    const update = () => { const el = document.querySelector(selector); if (el) setRect(el.getBoundingClientRect()); };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [s.target]);

  // Focus the card and close on Escape.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); finish(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The spotlight box, clamped so it never sits behind the bottom card. If the
  // section is taller than the space above the card, only its top portion is
  // ringed (the ring's bottom stops at the card).
  const spotlight = (() => {
    if (!rect) return null;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const maxBottom = vh - cardH - CARD_GAP;
    const top = Math.max(8, rect.top - 6);
    const rawBottom = rect.bottom + 6;
    const bottom = Math.min(rawBottom, maxBottom);
    const height = bottom - top;
    if (height < 40) return null; // no usable room — fall back to a plain dim
    return { left: Math.max(6, rect.left - 6), top, width: Math.min(rect.width + 12, (typeof window !== "undefined" ? window.innerWidth : 400) - 12), height };
  })();

  return createPortal(
    <div data-testid="tutorial" role="dialog" aria-modal="true" aria-label="App tour" className="fixed inset-0 z-[140]">
      {/* Transparent click-blocker so the rest of the app can't be interacted
          with during the tour (the spotlight visual is pointer-events none). */}
      <div className="absolute inset-0" />
      {spotlight ? (
        <div className="pointer-events-none fixed transition-all duration-200"
          style={{
            left: spotlight.left, top: spotlight.top, width: spotlight.width, height: spotlight.height,
            borderRadius: 18, outline: "2px solid hsl(var(--primary))", outlineOffset: 0,
            boxShadow: "0 0 0 9999px rgba(20,16,12,0.5)",
          }} />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-foreground/45 backdrop-blur-[2px]" />
      )}

      {/* Compact bottom card. max-h + internal scroll keeps it usable on small
          screens; sits above the bottom nav. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center p-4 sm:inset-0 sm:items-center sm:p-5">
        <div ref={cardRef} tabIndex={-1}
          className="pointer-events-auto mb-[calc(4.25rem+env(safe-area-inset-bottom))] max-h-[46vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-xl outline-none sm:mb-0 sm:max-h-none sm:rounded-3xl sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl gradient-primary shadow-glow sm:h-11 sm:w-11">
                <Icon size={18} className="text-white" />
              </div>
              <h3 className="font-display text-base font-semibold sm:text-lg">{s.title}</h3>
            </div>
            <button onClick={finish} className="shrink-0 rounded-full px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground">
              Skip
            </button>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground sm:text-sm">{s.body}</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex shrink-0 gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
              {STEPS.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-primary" : "w-1.5 bg-border"}`} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button onClick={() => setStep(step - 1)}
                  className="rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                  Back
                </button>
              )}
              <button onClick={() => (last ? finish() : setStep(step + 1))}
                className="rounded-full gradient-primary px-5 py-2 text-sm font-semibold text-white shadow-glow transition active:scale-95">
                {last ? "Get started" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
