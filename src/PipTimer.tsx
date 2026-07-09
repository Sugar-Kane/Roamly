import type { ReactNode } from "react";
import { TimeDisplay } from "./FocusMode";

// The compact timer shown inside the Document Picture-in-Picture window. Purely
// presentational and prop-driven so it serves BOTH the personal timer (with
// Pause/Skip controls) and the shared room timers (no controls — a room's timer
// is server-synced and can't be paused). It's rendered via a portal from App /
// RoomView, so it reflects the same live timer and stays perfectly in sync.
// Relies on the opener's stylesheet + theme vars being cloned into the PiP
// document (useDocumentPip.copyStylesToPip / applyThemeToPip).
export function PipTimer({ phaseLabel, ring, timeText, progress, taskTitle, controls }: {
  phaseLabel: string;
  ring: string;
  timeText: string;
  progress: number;
  taskTitle?: string;
  controls?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-background px-4 py-4 text-foreground">
      <span className="font-mono text-[0.65rem] uppercase tracking-[0.25em]" style={{ color: ring }}>{phaseLabel}</span>
      <TimeDisplay value={timeText} className="font-display text-6xl font-medium tracking-tight" />

      <div className="h-1.5 w-full max-w-[15rem] overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}>
        <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: ring, transition: "width 1s linear" }} />
      </div>

      {taskTitle && (
        <p className="max-w-full truncate text-center text-xs text-muted-foreground">{taskTitle}</p>
      )}

      {controls && <div className="mt-1 flex items-center gap-2">{controls}</div>}
    </div>
  );
}
