import { useCallback, useEffect, useRef, useState } from "react";
import type { Method } from "./data";
import { playChime } from "./sound";

export type Phase = "focus" | "short" | "long";

export function useTimer(method: Method, onPhaseComplete?: (finishedPhase: Phase) => void) {
  const [phase, setPhase] = useState<Phase>("focus");
  const [secondsLeft, setSecondsLeft] = useState(method.focus * 60);
  const [running, setRunning] = useState(false);
  const [completedFocus, setCompletedFocus] = useState(0);
  const tick = useRef<number | null>(null);
  const onPhaseCompleteRef = useRef(onPhaseComplete);

  useEffect(() => { onPhaseCompleteRef.current = onPhaseComplete; }, [onPhaseComplete]);

  const phaseLength = useCallback(
    (p: Phase) => (p === "focus" ? method.focus : p === "short" ? method.short : method.long) * 60,
    [method]
  );

  // Reset whenever the method changes.
  useEffect(() => {
    setPhase("focus");
    setSecondsLeft(method.focus * 60);
    setRunning(false);
    setCompletedFocus(0);
  }, [method.id, method.focus]);

  const advance = useCallback(() => {
    if (phase === "focus") {
      const nextCount = completedFocus + 1;
      setCompletedFocus(nextCount);
      const goLong = nextCount % method.cycles === 0;
      const next: Phase = goLong ? "long" : "short";
      setPhase(next);
      setSecondsLeft(phaseLength(next));
    } else {
      setPhase("focus");
      setSecondsLeft(phaseLength("focus"));
    }
  }, [phase, completedFocus, method.cycles, phaseLength]);

  useEffect(() => {
    if (!running) return;
    tick.current = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          playChime(); // end-of-phase cue (session end + break over)
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, [running]);

  useEffect(() => {
    if (secondsLeft === 0 && running) {
      setRunning(false);
      onPhaseCompleteRef.current?.(phase);
      advance();
    }
  }, [secondsLeft, running, advance, phase]);

  const total = phaseLength(phase);
  const progress = 1 - secondsLeft / total;

  const start = () => setRunning(true);
  const pause = () => setRunning(false);
  const reset = () => { setRunning(false); setSecondsLeft(phaseLength(phase)); };
  const skip = () => { setRunning(false); advance(); };

  return { phase, secondsLeft, running, progress, completedFocus, start, pause, reset, skip };
}

export const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
