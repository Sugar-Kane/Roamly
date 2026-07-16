// App settings in one place: the on-device preferences (timer confetti and the
// accessibility toggles) plus a replay of the app tour. These used to be a
// grab-bag of rows crammed into the profile dropdown; consolidating them here
// keeps that menu to a one-glance launcher. Everything works signed-out (the
// prefs are device-local), so this modal never requires an account.
import { HelpCircle, X, ChevronRight } from "lucide-react";
import { Modal } from "./Modal";
import type { A11ySettings } from "./ProfileMenu";

const A11Y_OPTIONS: { key: keyof A11ySettings; label: string; hint: string }[] = [
  { key: "colorBlind", label: "Color-blind friendly", hint: "Blue/orange timer and status colors" },
  { key: "highContrast", label: "High contrast", hint: "Stronger text and borders" },
  { key: "reduceMotion", label: "Reduce motion", hint: "Minimize animations" },
  { key: "largeText", label: "Larger text", hint: "Increase the app's font size" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{title}</h3>
      <div className="mt-1.5 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/70">{children}</div>
    </section>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-primary" : "bg-border"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function ToggleRow({ label, hint, on, onClick }: { label: string; hint: string; on: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <Toggle on={on} onClick={onClick} label={label} />
    </div>
  );
}

export function SettingsModal({ a11y, setA11y, confettiOn, onToggleConfetti, onReplayTutorial, onClose }: {
  a11y: A11ySettings;
  setA11y: (next: A11ySettings) => void;
  confettiOn: boolean;
  onToggleConfetti: () => void;
  onReplayTutorial: () => void;
  onClose: () => void;
}) {
  const flip = (key: keyof A11ySettings) => setA11y({ ...a11y, [key]: !a11y[key] });

  return (
    <Modal label="Settings" onClose={onClose} testId="settings-modal"
      cardClassName="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="font-display text-lg font-semibold">Settings</h2>
        <button onClick={onClose} aria-label="Close settings"
          className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground">
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-1">
        <Section title="Timer">
          <ToggleRow label="Completion confetti"
            hint="Celebrate finished focus sessions. Reduce motion also turns it off."
            on={confettiOn} onClick={onToggleConfetti} />
        </Section>

        <Section title="Accessibility">
          {A11Y_OPTIONS.map((o) => (
            <ToggleRow key={o.key} label={o.label} hint={o.hint} on={a11y[o.key]} onClick={() => flip(o.key)} />
          ))}
        </Section>

        <Section title="Guide">
          <button onClick={() => { onReplayTutorial(); onClose(); }}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-secondary/60">
            <span className="flex min-w-0 items-center gap-2">
              <HelpCircle size={15} className="shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">App tour</span>
                <span className="block truncate text-[11px] text-muted-foreground">Replay the quick walkthrough of every feature</span>
              </span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
          </button>
        </Section>
      </div>
    </Modal>
  );
}
