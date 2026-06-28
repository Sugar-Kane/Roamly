import { useCallback, useEffect, useRef, useState } from "react";
import type { Method } from "./data";

export type Phase = "focus" | "short" | "long";

export function useTimer(method: Method) {
  const [phase, setPhase] = useState<Phase>("focus");
  const [secondsLeft, setSecondsLeft] = useState(method.focus * 60);
  const [running, setRunning] = useState(false);
  const [completedFocus, setCompletedFocus] = useState(0);
  const tick = useRef<number | null>(null);

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
          // Gentle audio cue.
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.frequency.value = 528; g.gain.setValueAtTime(0.001, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
            o.start(); o.stop(ctx.currentTime + 1.2);
          } catch { /* audio not available */ }
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
      advance();
    }
  }, [secondsLeft, running, advance]);

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
