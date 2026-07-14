import { useCallback, useEffect, useRef, useState } from "react";

// "Too distracting" makes the companions walk to bed and sleep — but only until
// the timer is up. This hook owns that asleep state and wakes them the moment
// the focus block ends (phase leaves "focus") or the timer is reset/stopped, so
// they're awake and ready for the next block. Shared by the solo timer and
// Focus mode so the state survives entering/leaving the full-screen view.
export function usePetSleep(timer: { phase: string; running: boolean }) {
  const [asleep, setAsleep] = useState(false);
  const prevPhase = useRef(timer.phase);
  const prevRunning = useRef(timer.running);

  useEffect(() => {
    const leftPhase = prevPhase.current;
    prevPhase.current = timer.phase;
    const wasRunning = prevRunning.current;
    prevRunning.current = timer.running;
    if (!asleep) return;
    // Wake on an actual transition: the focus block ended, or a running timer
    // was just stopped (paused/reset). Note we key off transitions, not the
    // static "not running" state — otherwise sleeping before pressing Start
    // would wake the pets instantly.
    if (leftPhase === "focus" && timer.phase !== "focus") setAsleep(false);
    else if (wasRunning && !timer.running) setAsleep(false);
  }, [timer.phase, timer.running, asleep]);

  return {
    asleep,
    sleep: useCallback(() => setAsleep(true), []),
    wake: useCallback(() => setAsleep(false), []),
  };
}
