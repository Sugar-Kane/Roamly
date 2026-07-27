// Customize Session: the drawer that gathers the secondary timer options that
// used to crowd the timer as a row of chips. Grouped per the approved design:
// session experience (pets, confetti), timer behavior (auto-flow, pop-out),
// and session ending (completion sound, browser notifications). Everything
// applies immediately — these drive exactly the same preferences the old
// chips did, so nothing resets or migrates.

import { Drawer, DrawerSection, DrawerRow } from "./Drawer";
import { BellOff } from "lucide-react";

const NOTIFY_HINT = {
  on: "You'll get a system notification at each phase end, even in another tab.",
  off: "Get a system notification when a phase ends, even in another tab.",
  denied: "Blocked in your browser's site settings. In-app alerts still work.",
};

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-primary" : "bg-border"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function CustomizeSession({ onClose, companionsOn, onToggleCompanions, gardenOn, onToggleGarden, confettiOn, onToggleConfetti, autoFlow, onToggleAutoFlow, alerts }: {
  onClose: () => void;
  companionsOn: boolean;
  onToggleCompanions: () => void;
  gardenOn: boolean;
  onToggleGarden: () => void;
  confettiOn: boolean;
  onToggleConfetti: () => void;
  autoFlow: boolean;
  onToggleAutoFlow: () => void;
  alerts: {
    permission: string;
    soundEnabled: boolean;
    setSoundEnabled: (on: boolean) => void;
    notifyEnabled: boolean;
    setNotifyEnabled: (on: boolean) => void;
  };
}) {
  const blocked = alerts.permission === "denied";
  // "Granted but switched off in-app" and "never asked" both read as off — the
  // switch reflects whether notifications will actually arrive, not the raw
  // browser permission.
  const notifyOn = alerts.permission === "granted" && alerts.notifyEnabled;
  return (
    <Drawer label="Customize Session" onClose={onClose} testId="customize-session">
      <DrawerSection title="Session experience">
        <DrawerRow label="Show pets during focus" hint="Your Garden companions keep you company on the timer.">
          <Toggle on={companionsOn} onClick={onToggleCompanions} label="Show pets during focus" />
        </DrawerRow>
        <DrawerRow label="Show garden during focus" hint="Your planted garden on the timer. It rains on breaks — the plants are getting watered.">
          <Toggle on={gardenOn} onClick={onToggleGarden} label="Show garden during focus" />
        </DrawerRow>
        <DrawerRow label="Completion confetti" hint="Celebrate finished focus sessions. Reduce motion also turns it off.">
          <Toggle on={confettiOn} onClick={onToggleConfetti} label="Completion confetti" />
        </DrawerRow>
      </DrawerSection>

      <DrawerSection title="Timer behavior">
        <DrawerRow label="Auto-flow" hint="Focus rolls into break and back without pressing Start.">
          <Toggle on={autoFlow} onClick={onToggleAutoFlow} label="Auto-flow" />
        </DrawerRow>
      </DrawerSection>

      <DrawerSection title="Session ending">
        <DrawerRow label="Completion sound" hint="A short chime when a focus block or break finishes.">
          <Toggle on={alerts.soundEnabled} onClick={() => alerts.setSoundEnabled(!alerts.soundEnabled)} label="Completion sound" />
        </DrawerRow>
        {/* One switch for all three permission states. Turning it on asks for
            the browser permission when that hasn't been granted yet, so there's
            no separate Enable button. Blocked is the only dead end — the
            permission can only be restored from the browser's own site
            settings, so the switch is disabled and says so. */}
        {alerts.permission !== "unsupported" && (
          <DrawerRow label="Browser notifications" hint={NOTIFY_HINT[blocked ? "denied" : notifyOn ? "on" : "off"]}>
            {blocked ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><BellOff size={13} /> Blocked</span>
            ) : (
              <Toggle on={notifyOn} onClick={() => alerts.setNotifyEnabled(!notifyOn)} label="Browser notifications" />
            )}
          </DrawerRow>
        )}
      </DrawerSection>
    </Drawer>
  );
}
