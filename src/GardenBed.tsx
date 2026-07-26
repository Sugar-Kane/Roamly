// The garden bed — its own area, separate from the companion pen.
//
// Every planted reward gets a spot in the soil, sized by its own growth stage
// (a fresh seedling is small; a mature tree towers). The bed is DOM rather than
// canvas on purpose: the plant count is unbounded, and flex-wrap plus a
// count-driven scale is what guarantees "it all fits" at any width without the
// manual layout math a canvas would need.
//
// Growth is earned, not decorative: each plant's stage comes from the
// growth_points the server accrues per completed session, so planting more
// things is a reason to keep studying.

import { GROWTH_STAGES, growthLabel } from "./petCatalog";
import type { GardenPlant } from "./gamification";

// Plants shrink as the bed fills so a big garden still fits its box.
function plantScale(count: number): number {
  if (count <= 4) return 1;
  if (count <= 8) return 0.86;
  if (count <= 14) return 0.72;
  if (count <= 22) return 0.6;
  return 0.5;
}

// Rain streaks. Deterministic offsets keep the shower stable across renders
// instead of reshuffling every time the timer ticks.
const RAIN_DROPS = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 13) % 20) / 20,
  duration: 0.7 + ((i * 7) % 10) / 20,
  height: 8 + ((i * 5) % 3) * 4,
}));

export function GardenBed({ plants, reduceMotion, raining = false, className = "" }: {
  plants: GardenPlant[];
  reduceMotion: boolean;
  raining?: boolean; // breaks water the garden
  className?: string;
}) {
  const scale = plantScale(plants.length);
  // Reduced motion still gets the "it's raining" cue, just without falling
  // streaks — an overcast wash and the caption carry the meaning.
  const showStreaks = raining && !reduceMotion;

  return (
    <div className={`relative overflow-hidden rounded-xl border border-border ${className}`}>
      {/* Sky, then the dirt the plants sit in. */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-sky-200/40 to-transparent dark:from-sky-900/30" aria-hidden="true" />
      {raining && <div className="absolute inset-0 bg-slate-600/25 dark:bg-slate-900/35" aria-hidden="true" />}
      <div className="absolute inset-x-0 bottom-0 h-[42%]" aria-hidden="true"
        style={{ background: "linear-gradient(180deg,#7a5236 0%,#63412a 45%,#4e3220 100%)" }}>
        {/* Furrow lines + grit, so the soil reads as tilled earth. */}
        <div className="absolute inset-0 opacity-40" style={{
          backgroundImage:
            "repeating-linear-gradient(90deg,rgba(0,0,0,.16) 0 2px,transparent 2px 22px)," +
            "radial-gradient(circle at 20% 30%,rgba(0,0,0,.22) 0 2px,transparent 3px)," +
            "radial-gradient(circle at 70% 60%,rgba(255,255,255,.12) 0 1.5px,transparent 2px)",
        }} />
      </div>

      {plants.length === 0 ? (
        <p className="relative grid h-full place-items-center px-4 text-center text-xs text-muted-foreground">
          Your garden is empty — plant something from your level rewards below.
        </p>
      ) : (
        // Anchored to the soil line (the dirt starts at 58%), not to the box
        // bottom — percentage padding would resolve against width, not height.
        <ul className="absolute inset-x-0 top-0 flex h-[62%] flex-wrap items-end justify-center gap-x-1 gap-y-0 px-3">
          {plants.map((p) => {
            // Seedling → full grown across GROWTH_STAGES, scaled for crowding.
            const size = (18 + (p.stage / Math.max(1, GROWTH_STAGES - 1)) * 26) * scale;
            return (
              <li key={p.id} className="flex flex-col items-center" style={{ width: `${Math.max(30, size + 14)}px` }}
                title={`${p.name} — ${growthLabel(p.stage)}`}>
                <span aria-hidden="true"
                  className={reduceMotion ? "" : "garden-sway"}
                  style={{ fontSize: `${size}px`, lineHeight: 1, animationDelay: `${(p.id.length % 5) * 0.4}s` }}>
                  {p.emoji}
                </span>
                {/* A little mound so each plant looks rooted in the soil. */}
                <span aria-hidden="true" className="-mt-[2px] h-[6px] rounded-[50%] bg-black/25"
                  style={{ width: `${Math.max(10, size * 0.5)}px` }} />
              </li>
            );
          })}
        </ul>
      )}

      {/* Rain sits above the plants so drops fall in front of them. The layer
          stops at the soil line (58%), so every drop lands on the dirt rather
          than sinking through it — and each one gets a splash at the point of
          impact. Splash and drop share a delay and duration, so they stay in
          phase forever without any JS timing. */}
      {showStreaks && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[58%] overflow-hidden" aria-hidden="true">
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
        // Sits low over the soil, where nothing is drawn — up top it collided
        // with the tallest plants in a full bed.
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
