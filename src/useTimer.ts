import { useCallback, useEffect, useRef, useState } from "react";
import type { Method } from "./data";

export type Phase = "focus" | "short" | "long";

// Wall-clock timer: the remaining time is derived from a deadline timestamp,
// not accumulated from setInterval ticks. Background tabs and locked phones
// throttle/suspend intervals, so a tick-counting timer silently loses real
// time — a 25-min block could take far longer. Here the interval only drives
// re-renders; the actual countdown is always (deadline − now), so it stays
// correct across backgrounding (and simply reads 0 when the phase elapsed
// while the tab was hidden). Mirrors how rooms already derive phase from
// wall-clock time. Public API is unchanged.
export function useTimer(method: Method, onPhaseComplete?: (finishedPhase: Phase) => void) {
  const [phase, setPhase] = useState<Phase>("focus");
  const [running, setRunning] = useState(false);
  const [completedFocus, setCompletedFocus] = useState(0);
  // Seconds left while paused; when running, the live value comes from
  // deadlineRef instead and this holds the last frozen value.
  const [remaining, setRemaining] = useState(method.focus * 60);
  const deadlineRef = useRef<number | null>(null); // ms epoch the phase ends
  const [, forceRender] = useState(0);
  const onPhaseCompleteRef = useRef(onPhaseComplete);

  useEffect(() => { onPhaseCompleteRef.current = onPhaseComplete; }, [onPhaseComplete]);

  const phaseLength = useCallback(
    (p: Phase) => (p === "focus" ? method.focus : p === "short" ? method.short : method.long) * 60,
    [method]
  );

  // Reset whenever the method changes — including a Custom method's break or
  // cycle values, which the editor promises will restart the current timer.
  useEffect(() => {
    setPhase("focus");
    setRemaining(method.focus * 60);
    setRunning(false);
    deadlineRef.current = null;
    setCompletedFocus(0);
  }, [method.id, method.focus, method.short, method.long, method.cycles]);

  const advance = useCallback(() => {
    deadlineRef.current = null;
    if (phase === "focus") {
      const nextCount = completedFocus + 1;
      setCompletedFocus(nextCount);
      const next: Phase = nextCount % method.cycles === 0 ? "long" : "short";
      setPhase(next);
      setRemaining(phaseLength(next));
    } else {
      setPhase("focus");
      setRemaining(phaseLength("focus"));
    }
  }, [phase, completedFocus, method.cycles, phaseLength]);

  // Live remaining seconds: computed from the deadline while running so it's
  // immune to interval throttling; the frozen value while paused.
  const secondsLeft = running && deadlineRef.current != null
    ? Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000))
    : remaining;

  // Re-render ~4x/sec while running (so the display ticks), and detect the
  // phase boundary from real elapsed time. The chime lives here — a real
  // effect — not inside a state updater.
  useEffect(() => {
    if (!running || deadlineRef.current == null) return;
    let done = false; // fire the boundary exactly once across interval + refocus
    const check = () => {
      if (done) return;
      const left = Math.max(0, Math.ceil((deadlineRef.current! - Date.now()) / 1000));
      if (left <= 0) {
        done = true;
        window.clearInterval(iv);
        document.removeEventListener("visibilitychange", onVisible);
        setRunning(false);
        onPhaseCompleteRef.current?.(phase);
        advance();
      } else {
        forceRender((n) => n + 1);
      }
    };
    const iv = window.setInterval(check, 250);
    // A backgrounded/locked tab throttles this interval, so a phase that ends
    // while hidden would otherwise not chime, notify, or auto-advance until the
    // next throttled tick. Re-check the moment the tab is refocused so those
    // fire immediately on return. (A fully suspended tab still can't alert
    // mid-phase without a service worker — this just removes the return lag.)
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running, phase, advance]);

  const total = phaseLength(phase);
  const progress = total > 0 ? 1 - secondsLeft / total : 0;

  const start = () => {
    deadlineRef.current = Date.now() + remaining * 1000;
    setRunning(true);
  };
  const pause = () => {
    if (deadlineRef.current != null) {
      setRemaining(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    }
    deadlineRef.current = null;
    setRunning(false);
  };
  const reset = () => { setRunning(false); deadlineRef.current = null; setRemaining(phaseLength(phase)); };
  const skip = () => { setRunning(false); advance(); };

  return { phase, secondsLeft, running, progress, completedFocus, start, pause, reset, skip };
}

export const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
