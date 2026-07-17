// Guided tour: quick cards that walk a user through the app. Never opens
// automatically — it's launched from Settings' "App tour" row, the mobile
// More menu, or the "How Roamly Flow works" explainer. Each step switches to
// the real tab it describes AND spotlights the actual section on screen (a
// dimmed backdrop with a cutout ring around the target), so the user looks at
// the real UI being explained; exiting restores the tab the tour started
// from. Steps without a target (or whose target isn't on screen yet) fall
// back to a plain dimmed backdrop, so the tour never breaks.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Timer, ListChecks, Smartphone, Users, BarChart3, Sprout, type LucideIcon } from "lucide-react";
import type { View } from "./App";
import { track } from "./track";
import { savePref } from "./storage";

export const TUTORIAL_SEEN_KEY = "roamly-tutorial-seen";

// `target` is a CSS selector for the section to spotlight on that step; steps
// without one (e.g. the install tip) just dim the screen.
const STEPS: { view: View; icon: LucideIcon; title: string; body: string; target?: string }[] = [
  {
    view: "focus", icon: Timer, title: "Welcome to Roamly Flow", target: '[data-tour="timer"]',
    body: "This is your study timer. Tap “Select timer” to pick a rhythm, like 25 minutes of focus, then a 5-minute break, and hit Start. Roamly Flow runs the cycles for you.",
  },
  {
    view: "tasks", icon: ListChecks, title: "Queue your studying", target: '[data-tour="tasks"]',
    body: "Add tasks by subject and tick them off as you finish. Drag to reorder, or drag a task onto another subject to move it. Premium members can even upload lecture notes and let AI write the task list.",
  },
  {
    view: "rooms", icon: Users, title: "Study together", target: '[data-tour="rooms"]',
    body: "Every room's timer is already running. Just hit Join to drop in. You focus in silence alongside everyone inside, then chat and voice open at each break. Premium members can host private rooms for friends.",
  },
  {
    view: "garden", icon: Sprout, title: "Grow a garden and pets", target: '[data-tour="garden"]',
    body: "Your focus sessions grow a little garden and its companions. Keep studying to unlock plants, pets, and accessories — a gentle nudge to come back each day.",
  },
  {
    view: "analytics", icon: BarChart3, title: "Watch it add up", target: '[data-tour="analytics"]',
    body: "Every session lands here: your daily goal, streak, subject breakdown, and achievements. Replay this tour anytime from your profile menu.",
  },
  {
    view: "focus", icon: Smartphone, title: "Put Roamly Flow on your Home Screen",
    body: "On iPhone: tap Safari's Share button (the square with the arrow), then “Add to Home Screen”. Roamly Flow opens full-screen like a real app, with its own icon. On Android or desktop, use the browser menu, then “Install app”.",
  },
];

// Scroll the target into the part of the screen the tour card doesn't cover:
// on phones the card is a bottom sheet over the lower ~40% of the viewport, so
// the target's center is aimed at ~30% height; on larger screens the card is
// centered, so the target aims a bit above center. Very tall targets are
// anchored by their top portion so at least their start is visible.
function scrollTargetIntoView(el: Element) {
  const rect = el.getBoundingClientRect();
  const viewport = window.innerHeight;
  const phone = window.innerWidth < 640;
  const anchor = viewport * (phone ? 0.3 : 0.42);
  const visibleHeight = Math.min(rect.height, viewport * (phone ? 0.45 : 0.7));
  window.scrollBy({ top: rect.top + visibleHeight / 2 - anchor, behavior: "smooth" });
}

export function Tutorial({ setView, returnView = "focus", onClose }: { setView: (v: View) => void; returnView?: View; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const Icon = s.icon;

  const finish = () => {
    track("tutorial_done");
    savePref(TUTORIAL_SEEN_KEY, "1");
    // The tour switches tabs to spotlight real UI; exiting puts the user back
    // on whichever tab they started it from instead of dumping them on Focus.
    setView(returnView);
    onClose();
  };

  // Switch to the step's tab, then find and scroll to its highlighted section.
  // The target may not be mounted the instant the tab switches, so poll a few
  // animation frames before giving up (which just dims the whole screen).
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
        scrollTargetIntoView(el);
        settle = window.setTimeout(() => setRect(el.getBoundingClientRect()), 320);
      } else if (tries++ < 30) {
        raf = requestAnimationFrame(locate);
      }
    };
    raf = requestAnimationFrame(locate);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(settle); };
  }, [step, s.view, s.target, setView]);

  // Keep the spotlight aligned while the page scrolls or resizes — including
  // device rotation and mobile browser toolbar show/hide (visualViewport).
  useEffect(() => {
    if (!s.target) return;
    const selector = s.target;
    const update = () => { const el = document.querySelector(selector); if (el) setRect(el.getBoundingClientRect()); };
    // Rotation reflows the whole layout; re-scroll so the target stays in the
    // uncovered part of the screen, then re-measure once things settle.
    const onOrientation = () => {
      const el = document.querySelector(selector);
      if (el) { scrollTargetIntoView(el); window.setTimeout(update, 350); }
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.addEventListener("orientationchange", onOrientation);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, [s.target]);

  // Focus the card and close on Escape.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); finish(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div data-testid="tutorial" role="dialog" aria-modal="true" aria-label="App tour" className="fixed inset-0 z-[140]">
      {/* Transparent click-blocker so the rest of the app can't be interacted
          with during the tour (the spotlight visual is pointer-events none). */}
      <div className="absolute inset-0" />
      {rect ? (
        <div className="pointer-events-none fixed transition-all duration-200"
          style={{
            left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12,
            borderRadius: 18, outline: "2px solid hsl(var(--primary))",
            boxShadow: "0 0 0 9999px rgba(20,16,12,0.55)",
          }} />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-foreground/40 backdrop-blur-[2px]" />
      )}

      {/* Bottom sheet on phones (thumb-reachable, highlighted section visible
          above it), centered from sm up. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center p-5 sm:inset-0 sm:items-center">
        <div ref={cardRef} tabIndex={-1}
          className="pointer-events-auto mb-[calc(4.25rem+env(safe-area-inset-bottom))] max-h-[min(70dvh,calc(100dvh-5rem))] w-full max-w-sm overflow-y-auto overscroll-contain rounded-3xl border border-border bg-card p-5 shadow-xl outline-none sm:mb-0 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl gradient-primary shadow-glow">
              <Icon size={22} className="text-white" />
            </div>
            <button onClick={finish} className="rounded-full px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground">
              Skip tour
            </button>
          </div>
          <h3 className="mt-4 font-display text-xl font-semibold">{s.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="flex shrink-0 items-center gap-2" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
              <span className="flex gap-1.5">
                {STEPS.map((_, i) => (
                  <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-5 bg-primary" : "w-1.5 bg-border"}`} />
                ))}
              </span>
              <span aria-hidden className="font-mono text-[10px] text-muted-foreground">{step + 1} of {STEPS.length}</span>
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
