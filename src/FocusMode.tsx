import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, Play, Pause, Volume2, VolumeX, Moon, Info } from "lucide-react";
import { FOCUS_SOUNDS, type FocusSoundId } from "./focusSounds";
import { loadPref, savePref } from "./storage";

type Phase = "focus" | "short" | "long";

// Tap-to-open "?" bubble explaining a control. Lives here (not App.tsx) so
// any component can use it without importing the App module graph. The bubble
// renders through a portal as a fixed element clamped to the viewport —
// otherwise ancestors with overflow-hidden (like the timer card) clip it.
export function InfoTip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const open = pos !== null;

  const toggle = () => {
    if (open) { setPos(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(224, window.innerWidth - 24);
    const left = Math.min(Math.max(12, r.left), window.innerWidth - 12 - width);
    setPos({ left, top: r.bottom + 6, width });
  };

  // A fixed bubble must not hang around once the page moves or the user taps
  // elsewhere — close on scroll and on any outside pointer press.
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: PointerEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener("scroll", close, { passive: true, capture: true });
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", close, { capture: true } as EventListenerOptions);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button ref={btnRef} type="button" onClick={toggle} aria-label="What does this mean?"
        className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground transition hover:text-foreground">
        <Info size={14} />
      </button>
      {open && createPortal(
        <span style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 150 }}
          className="rounded-lg border border-border bg-card p-2.5 text-left text-xs font-normal leading-snug text-muted-foreground shadow-lg">
          {text}
        </span>,
        document.body
      )}
    </span>
  );
}

// Renders each character in a fixed-width slot so the total width never
// changes as digits tick (Fraunces digits aren't equal-width and
// tabular-nums is unreliable there). Shared by every timer surface.
export function TimeDisplay({ value, className }: { value: string; className?: string }) {
  return (
    <span className={`inline-flex leading-none ${className ?? ""}`} style={{ fontVariantNumeric: "tabular-nums" }} aria-label={value}>
      {value.split("").map((ch, i) => (
        <span key={i} className="inline-flex justify-center" style={{ width: ch === ":" ? "0.42em" : "0.62em" }}>
          {ch}
        </span>
      ))}
    </span>
  );
}

// Keeps the screen awake and (where supported) takes over the whole display
// while focus mode is open. Native Fullscreen works on desktop/laptop/most
// tablets; iOS Safari refuses it for regular elements, so the in-app overlay is
// the real mechanism and fullscreen is a best-effort bonus. Everything is
// feature-detected and wrapped so unsupported platforms simply no-op.
function useImmersive(open: boolean) {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    let wakeLock: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    const acquireLock = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl && !cancelled) wakeLock = await wl.request("screen");
      } catch { /* denied / unsupported — fine */ }
    };
    const onVisibility = () => { if (!document.hidden && !cancelled) void acquireLock(); };

    try { void document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* iOS */ }
    void acquireLock();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.body.style.overflow = "";
      document.removeEventListener("visibilitychange", onVisibility);
      try { void wakeLock?.release(); } catch { /* already gone */ }
      if (document.fullscreenElement) { try { void document.exitFullscreen?.().catch(() => {}); } catch { /* ignore */ } }
    };
  }, [open]);
}

export function FocusMode({
  open, phase, phaseLabel, timeText, progress, title, subtitle, cycles, completed, ring,
  onExit, controls, music, extra, companions,
}: {
  open: boolean;
  phase: Phase;
  phaseLabel: string;
  timeText: string;
  progress: number;
  title?: string;
  subtitle?: string;
  cycles?: number;
  completed?: number;
  ring: string;
  onExit: () => void;
  controls?: ReactNode;
  music?: ReactNode;
  extra?: ReactNode;
  companions?: ReactNode; // pet/plant stage drawn over the timer
}) {
  useImmersive(open);
  const [showNudge, setShowNudge] = useState(() => loadPref("roamly-dnd-nudge-seen") !== "1");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onExit]);

  if (!open) return null;
  const focusing = phase === "focus";
  const dismissNudge = () => { savePref("roamly-dnd-nudge-seen", "1"); setShowNudge(false); };

  return (
    <div data-testid="focus-overlay" className="fixed inset-0 z-[120] flex flex-col bg-background text-foreground"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* soft accent wash so the phase reads at a glance */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ background: `radial-gradient(60% 50% at 50% 30%, ${ring}, transparent)` }} />

      <div className="relative flex items-center justify-between px-5 py-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em]" style={{ color: ring }}>
          {focusing ? "Focus mode" : "On a break"}
        </span>
        <button onClick={onExit} aria-label="Exit focus mode"
          className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
          <X size={14} /> Exit
        </button>
      </div>

      {/* m-auto (not justify-center) so short content centers but overflowing
          content top-aligns — with justify-center the top half (the timer!)
          gets pushed above the scrollport on phones. From lg the content
          splits into two columns (timer left, music + tasks right) so a whole
          session fits one desktop screen with no page scroll. */}
      <div className="relative flex flex-1 flex-col overflow-y-auto px-5 pb-6 lg:overflow-hidden">
        <div className="m-auto flex w-full flex-col items-center gap-6 lg:max-w-6xl lg:flex-row lg:items-stretch lg:justify-center lg:gap-10">

        {/* LEFT: timer, progress, controls */}
        <div className="flex w-full flex-col items-center gap-6 lg:flex-1 lg:justify-center">
        {focusing && showNudge && (
          <div className="flex max-w-md items-start gap-2 rounded-2xl border border-border bg-card/70 px-4 py-3 text-left">
            <Moon size={16} className="mt-0.5 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              A website can't silence your phone. Turn on your device's <span className="font-medium text-foreground">Focus / Do Not Disturb</span> for a true deep-work block.
              <button onClick={dismissNudge} className="ml-1 font-medium text-primary underline-offset-2 hover:underline">Got it</button>
            </p>
          </div>
        )}

        <div className="relative flex flex-col items-center">
          {companions && <div className="pointer-events-none absolute inset-x-0 -top-16 h-16 sm:-top-20 sm:h-20">{companions}</div>}
          <span className="font-mono text-xs uppercase tracking-[0.25em]" style={{ color: ring }}>{phaseLabel}</span>
          <TimeDisplay value={timeText} className="font-display text-[20vw] font-medium tracking-tight sm:text-[15vw] lg:text-[8.5rem] xl:text-[10rem]" />
          {title && <span className="mt-2 max-w-[80vw] truncate text-base text-foreground">{title}</span>}
          {subtitle && <span className="mt-0.5 text-sm text-muted-foreground">{subtitle}</span>}
        </div>

        <div className="w-full max-w-md">
          <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%`, background: ring, transition: "width 1s linear" }} />
          </div>
          {typeof cycles === "number" && cycles > 0 && (
            <div className="mt-2 flex justify-center gap-1.5">
              {Array.from({ length: cycles }).map((_, i) => (
                <span key={i} className="h-1.5 w-6 rounded-full" style={{ background: i < ((completed ?? 0) % cycles) ? ring : "hsl(var(--border))" }} />
              ))}
            </div>
          )}
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {focusing ? "Eyes here. Notifications quiet themselves in your device's Focus mode." : "Break time. Look away, stretch, breathe. Your alerts are back on."}
          </p>
        </div>

        {controls && <div className="flex items-center justify-center gap-3">{controls}</div>}
        </div>

        {/* RIGHT: music + tasks/panels. On desktop this column caps to the
            viewport and scrolls internally only in the rare tall case (an open
            Spotify embed), so the page itself never scrolls; my-auto centers it
            when it fits. */}
        {(music || extra) && (
          <div className="flex w-full max-w-md flex-col lg:w-[26rem] lg:shrink-0 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
            <div className="flex flex-col gap-4 lg:my-auto">
              {music && <div className="w-full rounded-2xl border border-border bg-card/70 p-3">{music}</div>}
              {extra && <div className="w-full">{extra}</div>}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

// Compact music picker for the personal focus overlay, driven by the same
// `sounds` object the Focus tab uses.
export function CompactSounds({ sounds }: {
  sounds: {
    sound: FocusSoundId | null; playing: boolean; volume: number;
    choose: (id: FocusSoundId) => void; toggle: () => void; setVolume: (v: number) => void;
  };
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Music</span>
        <button onClick={sounds.toggle} disabled={!sounds.sound} aria-label={sounds.playing ? "Pause music" : "Play music"}
          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-40">
          {sounds.playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
      </div>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {FOCUS_SOUNDS.map((s) => {
          const active = sounds.sound === s.id;
          return (
            <button key={s.id} onClick={() => sounds.choose(s.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
              {s.name}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2 px-1">
        {sounds.volume === 0 ? <VolumeX size={14} className="shrink-0 text-muted-foreground" /> : <Volume2 size={14} className="shrink-0 text-muted-foreground" />}
        <input type="range" min={0} max={1} step={0.05} value={sounds.volume}
          onChange={(e) => sounds.setVolume(Number(e.target.value))} aria-label="Music volume"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-[hsl(var(--primary))]" />
      </div>
    </div>
  );
}
