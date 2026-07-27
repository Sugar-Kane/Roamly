// The garden bed — its own area, separate from the companion pen.
//
// Every planted reward gets a spot in the soil, sized by its own growth stage
// (a fresh seedling is small; a mature tree towers).
//
// Layout is measured rather than guessed. The plant count is unbounded but the
// card is a fixed box, so a fixed plant size either overflows or wastes space.
// Instead we measure the box and pick the largest size at which every plant
// fits — and lay them out on a grid of ROWS, each row with its own strip of
// soil, so a plant that wraps to a second row is still standing in the ground.
// (The previous flex-wrap version bottom-aligned each row independently, which
// left every row but the last floating in mid-air.)
//
// Growth is earned, not decorative: each plant's stage comes from the
// growth_points the server accrues per completed session, so planting more
// things is a reason to keep studying.

import { useEffect, useMemo, useRef, useState } from "react";
import { GROWTH_STAGES, growthLabel } from "./petCatalog";
import type { GardenPlant } from "./gamification";

// Rain streaks. Deterministic offsets keep the shower stable across renders
// instead of reshuffling every time the timer ticks.
const RAIN_DROPS = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 13) % 20) / 20,
  duration: 0.7 + ((i * 7) % 10) / 20,
  height: 8 + ((i * 5) % 3) * 4,
}));

const MAX_PLANT = 44;
const MIN_PLANT = 11;

type Layout = { size: number; cols: number; rows: number; rowH: number; soilH: number };

// Largest plant size at which every plant fits the measured box. Walks down
// from MAX_PLANT so the garden stays generous when there's room and packs
// tighter as it fills, rather than clipping or overflowing.
function fitLayout(count: number, w: number, h: number): Layout | null {
  if (count === 0 || w < 24 || h < 24) return null;
  for (let size = MAX_PLANT; size >= MIN_PLANT; size--) {
    const cols = Math.max(1, Math.floor(w / (size + 10)));
    const rows = Math.ceil(count / cols);
    const rowH = Math.round(size * 1.4);
    if (rows * rowH <= h) return { size, cols, rows, rowH, soilH: Math.max(7, Math.round(rowH * 0.3)) };
  }
  // Denser than we can honour — use the floor size and let the box scroll.
  const cols = Math.max(1, Math.floor(w / (MIN_PLANT + 10)));
  const rowH = Math.round(MIN_PLANT * 1.4);
  return { size: MIN_PLANT, cols, rows: Math.ceil(count / cols), rowH, soilH: Math.max(6, Math.round(rowH * 0.3)) };
}

export function GardenBed({ plants, reduceMotion, raining = false, className = "" }: {
  plants: GardenPlant[];
  reduceMotion: boolean;
  raining?: boolean; // breaks water the garden
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((b) => (Math.abs(b.w - r.width) < 1 && Math.abs(b.h - r.height) < 1 ? b : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => fitLayout(plants.length, box.w, box.h), [plants.length, box.w, box.h]);
  // Reduced motion still gets the "it's raining" cue, just without falling
  // streaks — an overcast wash and the caption carry the meaning.
  const showStreaks = raining && !reduceMotion;

  return (
    <div ref={boxRef} className={`relative overflow-hidden rounded-xl border border-border ${className}`}>
      {/* Sky behind everything. */}
      <div className="absolute inset-0 bg-gradient-to-b from-sky-200/40 to-transparent dark:from-sky-900/30" aria-hidden="true" />
      {raining && <div className="absolute inset-0 bg-slate-600/25 dark:bg-slate-900/35" aria-hidden="true" />}

      {plants.length === 0 || !layout ? (
        <p className="relative grid h-full place-items-center px-4 text-center text-xs text-muted-foreground">
          Your garden is empty — plant something from your level rewards below.
        </p>
      ) : (
        // Bottom-anchored so the bed grows upward from the base of the card.
        <div className="absolute inset-x-0 bottom-0" style={{ height: layout.rows * layout.rowH }}>
          {/* One soil band per row, so every row is actual ground rather than
              the single strip at the bottom the old layout had. */}
          <div className="absolute inset-0" aria-hidden="true" style={{
            background: `repeating-linear-gradient(180deg,` +
              `transparent 0 ${layout.rowH - layout.soilH}px,` +
              `#7a5236 ${layout.rowH - layout.soilH}px ${layout.rowH - layout.soilH * 0.45}px,` +
              `#573823 ${layout.rowH - layout.soilH * 0.45}px ${layout.rowH}px)`,
          }} />
          {/* Furrows and grit, masked to the soil bands — unmasked, the vertical
              furrow lines painted straight up through the sky. */}
          <div className="absolute inset-0 opacity-30" aria-hidden="true" style={{
            backgroundImage:
              "repeating-linear-gradient(90deg,rgba(0,0,0,.18) 0 2px,transparent 2px 22px)," +
              "radial-gradient(circle at 22% 40%,rgba(0,0,0,.22) 0 2px,transparent 3px)," +
              "radial-gradient(circle at 71% 70%,rgba(255,255,255,.12) 0 1.5px,transparent 2px)",
            WebkitMaskImage: `repeating-linear-gradient(180deg,transparent 0 ${layout.rowH - layout.soilH}px,#000 ${layout.rowH - layout.soilH}px ${layout.rowH}px)`,
            maskImage: `repeating-linear-gradient(180deg,transparent 0 ${layout.rowH - layout.soilH}px,#000 ${layout.rowH - layout.soilH}px ${layout.rowH}px)`,
          }} />

          <ul className="absolute inset-0 grid" style={{
            gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
            gridAutoRows: `${layout.rowH}px`,
          }}>
            {plants.map((p, i) => {
              // Seedling → full grown, scaled to whatever size fits the box.
              const grow = p.stage / Math.max(1, GROWTH_STAGES - 1);
              const size = layout.size * (0.5 + 0.5 * grow);
              // Centre a partial last row instead of leaving it hard left with
              // a long empty stretch of bed beside it.
              const lastRowCount = plants.length % layout.cols;
              const startsLastRow = lastRowCount > 0 && i === plants.length - lastRowCount;
              return (
                <li key={p.id} className="flex flex-col items-center justify-end"
                  style={{
                    paddingBottom: layout.soilH * 0.55,
                    gridColumnStart: startsLastRow ? Math.floor((layout.cols - lastRowCount) / 2) + 1 : undefined,
                  }}
                  title={`${p.name} — ${growthLabel(p.stage)}`}>
                  <span aria-hidden="true"
                    className={reduceMotion ? "" : "garden-sway"}
                    style={{ fontSize: `${size}px`, lineHeight: 1, animationDelay: `${(p.id.length % 5) * 0.4}s` }}>
                    {p.emoji}
                  </span>
                  {/* A little mound so each plant looks rooted in its row. */}
                  <span aria-hidden="true" className="mt-[1px] h-[5px] shrink-0 rounded-[50%] bg-black/30"
                    style={{ width: `${Math.max(9, size * 0.5)}px` }} />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Rain falls over the whole bed; splashes land at the base of the card. */}
      {showStreaks && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {RAIN_DROPS.map((d, i) => (
            <span key={i} className="garden-raindrop"
              style={{ left: `${d.left}%`, height: `${d.height}px`, animationDelay: `${d.delay}s`, animationDuration: `${d.duration}s` }} />
          ))}
          {RAIN_DROPS.map((d, i) => (
            <span key={`s${i}`} className="garden-splash"
              style={{ left: `${d.left}%`, animationDelay: `${d.delay}s`, animationDuration: `${d.duration}s` }} />
          ))}
        </div>
      )}
      {raining && (
        <span className="absolute bottom-1.5 right-2 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-medium text-white/90">
          Watering 💧
        </span>
      )}

      <ul className="sr-only">
        {plants.map((p) => <li key={p.id}>{p.name}, {growthLabel(p.stage)}</li>)}
      </ul>
      {raining && <p className="sr-only">Break time — your garden is getting watered.</p>}
    </div>
  );
}
