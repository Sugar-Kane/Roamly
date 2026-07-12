import { useCallback, useEffect, useRef, useState } from "react";

export function useCountUpTimer() {
  const [running, setRunning] = useState(false);
  const [elapsedBeforeRun, setElapsedBeforeRun] = useState(0);
  const startedAt = useRef<number | null>(null);
  const [, render] = useState(0);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => render((value) => value + 1), 250);
    return () => window.clearInterval(interval);
  }, [running]);

  const elapsedSeconds = running && startedAt.current !== null
    ? elapsedBeforeRun + Math.floor((Date.now() - startedAt.current) / 1000)
    : elapsedBeforeRun;

  const start = useCallback(() => {
    if (running) return;
    startedAt.current = Date.now();
    setRunning(true);
  }, [running]);

  const pause = useCallback(() => {
    if (!running || startedAt.current === null) return;
    setElapsedBeforeRun((value) => value + Math.floor((Date.now() - startedAt.current!) / 1000));
    startedAt.current = null;
    setRunning(false);
  }, [running]);

  const reset = useCallback(() => {
    startedAt.current = null;
    setRunning(false);
    setElapsedBeforeRun(0);
  }, []);

  const stop = useCallback(() => {
    const seconds = running && startedAt.current !== null
      ? elapsedBeforeRun + Math.floor((Date.now() - startedAt.current) / 1000)
      : elapsedBeforeRun;
    reset();
    return seconds;
  }, [elapsedBeforeRun, reset, running]);

  return { running, elapsedSeconds, start, pause, reset, stop };
}
