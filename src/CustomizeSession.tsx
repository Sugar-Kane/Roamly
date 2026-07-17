// Customize Session: the drawer that gathers the secondary timer options that
// used to crowd the timer as a row of chips. Grouped per the approved design:
// session experience (pets, confetti), timer behavior (auto-flow, pop-out),
// and session ending (completion sound, browser notifications). Everything
// applies immediately — these drive exactly the same preferences the old
// chips did, so nothing resets or migrates.

import { Drawer, DrawerSection, DrawerRow } from "./Drawer";
import { Bell, BellOff } from "lucide-react";

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-primary" : "bg-border"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function CustomizeSession({ onClose, companionsOn, onToggleCompanions, confettiOn, onToggleConfetti, autoFlow, onToggleAutoFlow, alerts }: {
  onClose: () => void;
  companionsOn: boolean;
  onToggleCompanions: () => void;
  confettiOn: boolean;
  onToggleConfetti: () => void;
  autoFlow: boolean;
  onToggleAutoFlow: () => void;
  alerts: {
    permission: string;
    requestPermission: () => void;
    soundEnabled: boolean;
    setSoundEnabled: (on: boolean) => void;
  };
}) {
  return (
    <Drawer label="Customize Session" onClose={onClose} testId="customize-session">
      <DrawerSection title="Session experience">
        <DrawerRow label="Show pets during focus" hint="Your Garden companions keep you company on the timer.">
          <Toggle on={companionsOn} onClick={onToggleCompanions} label="Show pets during focus" />
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
        {alerts.permission === "granted" && (
          <DrawerRow label="Browser notifications" hint="On — you'll get a system notification at each phase end.">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bell size={13} /> On</span>
          </DrawerRow>
        )}
        {alerts.permission === "denied" && (
          <DrawerRow label="Browser notifications" hint="Blocked in your browser's site settings. In-app alerts still work.">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><BellOff size={13} /> Blocked</span>
          </DrawerRow>
        )}
        {alerts.permission === "default" && (
          <DrawerRow label="Browser notifications" hint="Get a system notification when a phase ends, even in another tab.">
            <button onClick={alerts.requestPermission}
              className="flex min-h-[2.5rem] items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3.5 text-xs font-medium text-primary transition hover:bg-primary/15">
              <Bell size={13} /> Enable
            </button>
          </DrawerRow>
        )}
      </DrawerSection>
    </Drawer>
  );
}
