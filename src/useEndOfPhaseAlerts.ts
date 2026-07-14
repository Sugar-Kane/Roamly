import { useCallback, useEffect, useRef, useState } from "react";
import type { Phase } from "./useTimer";
import { playChime } from "./focusSounds";
import { loadPref, savePref } from "./storage";

const PHASE_MESSAGE: Record<Phase, string> = {
  focus: "Focus session complete. Time for a break.",
  short: "Short break's over. Back to it.",
  long: "Long break's over. Ready for the next block.",
};

const FLASH_TITLE = "⏰ Time's up! | Roamly";
const FLASH_INTERVAL_MS = 1000;
// The built-in two-note chime lasts about 1.1 seconds. Four plays spaced 1.3
// seconds apart create a clear notification sequence that runs for about five
// seconds without turning into a harsh continuous alarm.
const CHIME_REPEAT_MS = 1300;
const CHIME_REPEAT_COUNT = 4;

type Permission = NotificationPermission | "unsupported";

export function useEndOfPhaseAlerts() {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [permission, setPermission] = useState<Permission>(
    supported ? Notification.permission : "unsupported"
  );
  const [soundEnabled, setSoundEnabledState] = useState(() => loadPref("roamly-completion-sound") !== "off");

  const flashTimer = useRef<number | null>(null);
  const originalTitle = useRef<string | null>(null);
  const chimeTimers = useRef<number[]>([]);

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

  const stopChimeSequence = useCallback(() => {
    chimeTimers.current.forEach((timer) => window.clearTimeout(timer));
    chimeTimers.current = [];
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
      stopChimeSequence();
    };
  }, [stopFlashing, stopChimeSequence]);

  const requestPermission = useCallback(() => {
    if (!supported) return;
    Notification.requestPermission().then(setPermission);
  }, [supported]);

  const notify = useCallback((finishedPhase: Phase) => {
    if (soundEnabled) {
      stopChimeSequence();
      playChime();
      chimeTimers.current = Array.from({ length: CHIME_REPEAT_COUNT - 1 }, (_, index) =>
        window.setTimeout(playChime, CHIME_REPEAT_MS * (index + 1))
      );
    }
    if (supported && Notification.permission === "granted") {
      try {
        new Notification("Roamly Focus", { body: PHASE_MESSAGE[finishedPhase] });
      } catch { /* some browsers restrict Notification construction; ignore */ }
    }
    if (document.hidden) startFlashing();
  }, [supported, startFlashing, soundEnabled, stopChimeSequence]);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    savePref("roamly-completion-sound", enabled ? "on" : "off");
    if (!enabled) stopChimeSequence();
  }, [stopChimeSequence]);

  return { permission, requestPermission, notify, soundEnabled, setSoundEnabled };
}
