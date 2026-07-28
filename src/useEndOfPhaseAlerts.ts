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
  // A granted browser permission can't be revoked from JS, so "off" has to be
  // an app-level preference that gates delivery. Defaults on, which keeps the
  // old behaviour for anyone who already granted the permission.
  const [notifyEnabled, setNotifyEnabledState] = useState(() => loadPref("roamly-browser-notifications") !== "off");

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
    if (supported && notifyEnabled && Notification.permission === "granted") {
      try {
        new Notification("Roamly Flow", { body: PHASE_MESSAGE[finishedPhase] });
      } catch { /* some browsers restrict Notification construction; ignore */ }
    }
    // The title flash is the in-app fallback and stays on regardless — it's the
    // only end-of-phase signal left when notifications are off or blocked.
    if (document.hidden) startFlashing();
  }, [supported, startFlashing, notifyEnabled]);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    savePref("roamly-completion-sound", enabled ? "on" : "off");
    if (!enabled) stopChime();
  }, []);

  // Turning the toggle ON also handles the permission prompt, so the drawer
  // needs one control instead of an Enable button plus a switch. Enabling can
  // therefore fail (the user dismisses or blocks the prompt) — the state only
  // flips once the browser actually says "granted".
  const setNotifyEnabled = useCallback((enabled: boolean) => {
    if (!enabled) {
      setNotifyEnabledState(false);
      savePref("roamly-browser-notifications", "off");
      return;
    }
    if (!supported) return;
    if (Notification.permission === "granted") {
      setNotifyEnabledState(true);
      savePref("roamly-browser-notifications", "on");
      return;
    }
    if (Notification.permission === "denied") { setPermission("denied"); return; }
    Notification.requestPermission().then((p) => {
      setPermission(p);
      if (p !== "granted") return;
      setNotifyEnabledState(true);
      savePref("roamly-browser-notifications", "on");
    });
  }, [supported]);

  return { permission, requestPermission, notify, playEndingChime, soundEnabled, setSoundEnabled, notifyEnabled, setNotifyEnabled };
}
