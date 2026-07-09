import { Play, Pause, SkipForward } from "lucide-react";
import { fmt, type useTimer } from "./useTimer";
import { TimeDisplay } from "./FocusMode";

// The compact timer shown inside the Document Picture-in-Picture window. Purely
// presentational — it renders (via a portal from App) the SAME shared `timer`
// object, so it stays in perfect sync with the in-app countdown. Relies on the
// opener's stylesheet + theme vars being cloned into the PiP document
// (useDocumentPip.copyStylesToPip / applyThemeToPip).
export function PipTimer({ timer, phaseLabel, ring, taskTitle }: {
  timer: ReturnType<typeof useTimer>;
  phaseLabel: string;
  ring: string;
  taskTitle?: string;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-background px-4 py-4 text-foreground">
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.25em]" style={{ color: ring }}>{phaseLabel}</span>
      <TimeDisplay value={fmt(timer.secondsLeft)} className="font-display text-6xl font-medium tracking-tight" />

      <div className="h-1.5 w-full max-w-[15rem] overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}>
        <div className="h-full rounded-full" style={{ width: `${timer.progress * 100}%`, background: ring, transition: "width 1s linear" }} />
      </div>

      {taskTitle && (
        <p className="max-w-full truncate text-center text-xs text-muted-foreground">{taskTitle}</p>
      )}

      <div className="mt-1 flex items-center gap-2">
        <button
          onClick={() => (timer.running ? timer.pause() : timer.start())}
          className="flex h-11 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold text-white shadow-glow transition active:scale-[0.98]"
          style={{ background: ring }} aria-label={timer.running ? "Pause" : "Resume"}>
          {timer.running ? <><Pause size={18} fill="currentColor" /> Pause</> : <><Play size={18} fill="currentColor" /> Resume</>}
        </button>
        <button onClick={timer.skip}
          className="grid h-11 w-11 place-items-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          aria-label="Skip">
          <SkipForward size={16} />
        </button>
      </div>
    </div>
  );
}
