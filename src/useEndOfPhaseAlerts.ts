import { useCallback, useEffect, useRef, useState } from "react";
import type { Phase } from "./useTimer";
import { playChime, stopChime } from "./focusSounds";
import { loadPref, savePref } from "./storage";

const PHASE_MESSAGE: Record<Phase, string> = {
  focus: "Focus session complete. Time for a break.",
  short: "Short break's over. Back to it.",
  long: "Long break's over. Ready for the next block.",
};

const FLASH_TITLE = "⏰ Time's up! | Roamly Flow";
const FLASH_INTERVAL_MS = 1000;

type Permission = NotificationPermission | "unsupported";

export function useEndOfPhaseAlerts() {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [permission, setPermission] = useState<Permission>(
    supported ? Notification.permission : "unsupported"
  );
  const [soundEnabled, setSoundEnabledState] = useState(() => loadPref("roamly-completion-sound") !== "off");

  const flashTimer = useRef<number | null>(null);
  const originalTitle = useRef<string | null>(null);

  const stopFlashing = useCallback(() => {
    if (flashTimer.current !== null) {
      window.clearInterval(flashTimer.current);
      flashTimer.current = null;
    }
    if (originalTitle.current !== null) {
      document.title = originalTitle.current;
      originalTitle.current = null;
    }
  }, []);

  const startFlashing = useCallback(() => {
    stopFlashing(); // never stack more than one interval on repeated notify() calls
    originalTitle.current = document.title;
    let showAlert = true;
    flashTimer.current = window.setInterval(() => {
      document.title = showAlert ? FLASH_TITLE : (originalTitle.current ?? document.title);
      showAlert = !showAlert;
    }, FLASH_INTERVAL_MS);
  }, [stopFlashing]);

  useEffect(() => {
    const onVisibilityChange = () => { if (!document.hidden) stopFlashing(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopFlashing();
      stopChime();
    };
  }, [stopFlashing]);

  const requestPermission = useCallback(() => {
    if (!supported) return;
    Notification.requestPermission().then(setPermission);
  }, [supported]);

  const playEndingChime = useCallback((endingPhase: Phase) => {
    if (!soundEnabled) return;
    playChime(endingPhase === "focus" ? "focusEnd" : "breakEnd");
  }, [soundEnabled]);

  const notify = useCallback((finishedPhase: Phase) => {
    // The sound already starts three seconds before the boundary. At zero,
    // only deliver the notification/title alert so the chime cannot duplicate.
    if (supported && Notification.permission === "granted") {
      try {
        new Notification("Roamly Flow", { body: PHASE_MESSAGE[finishedPhase] });
      } catch { /* some browsers restrict Notification construction; ignore */ }
    }
    if (document.hidden) startFlashing();
  }, [supported, startFlashing, soundEnabled]);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    savePref("roamly-completion-sound", enabled ? "on" : "off");
    if (!enabled) stopChime();
  }, []);

  return { permission, requestPermission, notify, playEndingChime, soundEnabled, setSoundEnabled };
}
