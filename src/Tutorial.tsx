// First-run tour: five quick cards that walk a new user through the app.
// Each step switches the real tab behind a lightly-dimmed backdrop, so the
// user is looking at the actual screen being described — no fake mockups and
// no fragile spotlight anchoring. Finishing or skipping sets a localStorage
// flag; the header "?" button and the profile menu's "App tour" row clear the
// way back in anytime.

import { useEffect, useState } from "react";
import { Timer, ListChecks, Smartphone, Users, BarChart3, type LucideIcon } from "lucide-react";
import type { View } from "./App";
import { track } from "./track";
import { savePref } from "./storage";
import { Modal } from "./Modal";

export const TUTORIAL_SEEN_KEY = "roamly-tutorial-seen";

const STEPS: { view: View; icon: LucideIcon; title: string; body: string }[] = [
  {
    view: "focus", icon: Timer, title: "Welcome to Roamly",
    body: "This is your study timer. Tap “Select timer” to pick a rhythm — like 25 minutes of focus, then a 5-minute break — and hit Start. Roamly runs the cycles for you.",
  },
  {
    view: "tasks", icon: ListChecks, title: "Queue your studying",
    body: "Add tasks by subject and tick them off as you finish. Drag the ⋮⋮ handle to change priority. Premium members can even upload lecture notes and let AI write the task list.",
  },
  {
    view: "focus", icon: Smartphone, title: "Put Roamly on your Home Screen",
    body: "On iPhone: tap Safari's Share button (the square with the arrow), then “Add to Home Screen” — Roamly opens full-screen like a real app, with its own icon. On Android or desktop, use the browser menu → “Install app”.",
  },
  {
    view: "rooms", icon: Users, title: "Study together",
    body: "Every room's timer is already running — just hit Join to drop in. You focus in silence alongside everyone inside, then chat and voice open at each break. Premium members can host private rooms for friends.",
  },
  {
    view: "analytics", icon: BarChart3, title: "Watch it add up",
    body: "Every session lands here: your daily goal, streak, subject breakdown, and achievements. Replay this tour anytime from the ? button up top or your profile menu.",
  },
];

export function Tutorial({ setView, onClose }: { setView: (v: View) => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const Icon = s.icon;

  // Show the tab the current step is talking about.
  useEffect(() => { setView(STEPS[step].view); }, [step, setView]);

  const finish = () => {
    track("tutorial_done");
    savePref(TUTORIAL_SEEN_KEY, "1");
    setView("focus");
    onClose();
  };

  return (
    // Bottom sheet on phones (thumb-reachable, and the highlighted tab stays
    // visible above), centered from sm up. No backdrop-tap close — leaving the
    // tour is an explicit Skip/Get started so a stray tap can't eat it.
    <Modal label="App tour" onClose={finish} backdropClose={false} testId="tutorial"
      overlayClassName="fixed inset-0 z-[140] grid items-end justify-items-center bg-foreground/25 p-5 backdrop-blur-[2px] sm:items-center"
      cardClassName="mb-[calc(4.25rem+env(safe-area-inset-bottom))] w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl sm:mb-0">
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
    </Modal>
  );
}
