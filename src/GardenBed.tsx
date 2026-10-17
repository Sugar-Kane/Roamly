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
// Growth is earned, not decorative: each plant grows with the focus minutes
// run on the timer since it was planted (server growth_minutes), and the
// block running right now is added live, so the bed visibly grows while you
// study, and a stage reached mid-block gets a little sparkle. The numbers live
// in GardenGrowthBar, a full-width progress bar shown UNDER the bed (it was
// too small to read as per-plant bars inside it).
//
// Live growth is provisional: it banks when the focus block is recorded (a
// block abandoned early isn't saved, so its growth falls away again).

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { fmtMinutes, growthFromMinutes, growthFromSessions, growthLabel, type Growth } from "./petCatalog";
import type { GardenPlant } from "./gamification";
import { emojiSprite } from "./emojiSprite";

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
    if (rows * rowH <= h) return { size, cols, rows, rowH, soilH: Math.max(9, Math.round(rowH * 0.34)) };
  }
  // Denser than we can honour — use the floor size and let the box scroll.
  const cols = Math.max(1, Math.floor(w / (MIN_PLANT + 10)));
  const rowH = Math.round(MIN_PLANT * 1.4);
  return { size: MIN_PLANT, cols, rows: Math.ceil(count / cols), rowH, soilH: Math.max(7, Math.round(rowH * 0.34)) };
}

// A plant's growth with the live block folded in.
export function plantGrowth(p: GardenPlant, liveMinutes = 0): Growth {
  return p.minutes === null ? growthFromSessions(p.growth_points) : growthFromMinutes(p.minutes + Math.max(0, liveMinutes), p.kind);
}

export function growthCaption(p: GardenPlant, g: Growth): string {
  if (p.minutes === null) return growthLabel(g.stage);
  if (g.toNext <= 0) return `${growthLabel(g.stage)} · ${fmtMinutes(g.minutes)} grown`;
  return `${growthLabel(g.stage)} · ${fmtMinutes(g.toNext)} to ${growthLabel(g.stage + 1)}`;
}

// ---- Ground ----
// Deterministic pseudo-random in [0, 1) from integers, so the dirt's bumps and
// pebbles are stable between renders (no reshuffling on every timer tick).
const rnd = (a: number, b = 0) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// One strip of dirt per row: an uneven top edge with a lighter rim where the
// light catches it, topsoil that darkens with depth, fine grain from an SVG
// noise filter (clipped to the strip), a scatter of pebbles and clods, and a
// wet sheen when it rains.
function SoilRows({ rows, rowH, soilH, width, wet }: { rows: number; rowH: number; soilH: number; width: number; wet: boolean }) {
  const uid = useId().replace(/:/g, "");
  if (width <= 0) return null;
  const height = rows * rowH;
  const strips = Array.from({ length: rows }, (_, r) => {
    const top = r * rowH + (rowH - soilH);
    const bottom = (r + 1) * rowH;
    const edge: [number, number][] = [];
    for (let x = 0; x <= width + 6; x += 6) {
      const y = top + Math.sin(x * 0.083 + r * 1.7) * 0.7 + Math.sin(x * 0.029 + r * 4.1) * 1.1 + (rnd(x, r) - 0.5) * 0.9;
      edge.push([Math.min(x, width), y]);
    }
    const line = edge.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const d = `M0 ${bottom} L${edge.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L")} L${width} ${bottom} Z`;
    const pebbles = Array.from({ length: Math.max(3, Math.floor(width / 22)) }, (_, k) => {
      const px = (k + rnd(k, r + 9)) * (width / Math.max(3, Math.floor(width / 22)));
      // Upper rows fade out at the bottom, so keep their pebbles in the solid part.
      const py = top + soilH * (0.35 + (r === rows - 1 ? 0.55 : 0.3) * rnd(k, r + 3));
      const rx = 0.7 + rnd(k, r + 5) ** 2 * 2.6; // mostly grit, the odd stone
      const light = rnd(k, r + 7) > 0.55;
      return { px, py, rx, ry: rx * (0.55 + rnd(k, r + 11) * 0.25), fill: light ? "#8a7058" : "#2c1a0d", o: light ? 0.75 : 0.6 };
    });
    return { top, bottom, d, line, pebbles };
  });
  return (
    <svg className="absolute inset-0" width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-soil`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#74502f" />
          <stop offset="0.3" stopColor="#5b3c23" />
          <stop offset="1" stopColor="#3a2414" />
        </linearGradient>
        {/* Rows above the front one fade out at the bottom, so stacked rows
            read as terraces rather than shelves with a hard lower edge. */}
        <linearGradient id={`${uid}-soilfade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#74502f" />
          <stop offset="0.3" stopColor="#5b3c23" />
          <stop offset="0.7" stopColor="#4a2f1b" />
          <stop offset="1" stopColor="#3a2414" stopOpacity="0" />
        </linearGradient>
        {/* Grain: fractal noise, thresholded into dark crumbs and light grit,
            clipped to the strip's own shape. */}
        <filter id={`${uid}-grain`} x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.1  0 0 0 0 0.06  0 0 0 0 0.02  3.2 0 0 0 -1.55" result="dark" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.52  0 0 0 0 0.4  0 0 0 0 0.28  0 2.8 0 0 -2.05" result="light" />
          {/* Low-frequency, horizontally stretched noise: damp darker patches
              and faint layering, so the ground isn't one flat brown. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.22" numOctaves="2" seed="11" result="s" />
          <feColorMatrix in="s" type="matrix" values="0 0 0 0 0.09  0 0 0 0 0.05  0 0 0 0 0.02  1.5 0 0 0 -0.55" result="damp" />
          <feMerge result="crumbs"><feMergeNode in="damp" /><feMergeNode in="dark" /><feMergeNode in="light" /></feMerge>
          <feComposite in="crumbs" in2="SourceAlpha" operator="in" />
        </filter>
      </defs>
      {strips.map((st, r) => (
        <g key={r}>
          <path d={st.d} fill={`url(#${uid}-${r === rows - 1 ? "soil" : "soilfade"})`} />
          {/* The grain takes its alpha from this path, so on faded rows it fades too. */}
          <path d={st.d} fill={r === rows - 1 ? "#000" : `url(#${uid}-soilfade)`} filter={`url(#${uid}-grain)`} />
          {st.pebbles.map((pb, k) => (
            <ellipse key={k} cx={pb.px} cy={pb.py} rx={pb.rx} ry={pb.ry} fill={pb.fill} opacity={pb.o} />
          ))}
          {/* Lit rim on the crest, and a soft shade just under it. */}
          <polyline points={st.line} fill="none" stroke="#9b7650" strokeWidth={1.3} strokeLinejoin="round" opacity={0.9} />
          <polyline points={st.line} fill="none" stroke="#2a180b" strokeWidth={2} opacity={0.18} transform="translate(0 2)" />
          {/* Rain darkens the dirt (with a soft fade in and out). */}
          <path d={st.d} fill="#0d0703" style={{ opacity: wet ? 0.28 : 0, transition: "opacity 1.2s" }} />
        </g>
      ))}
    </svg>
  );
}

// A small heap of dirt banked up in front of a plant's stem.
function DirtMound({ width, height, wet, style }: { width: number; height: number; wet: boolean; style: CSSProperties }) {
  const uid = useId().replace(/:/g, "");
  const crest = `M0 ${height} Q ${width * 0.2} ${height * 0.3} ${width / 2} ${height * 0.1} Q ${width * 0.8} ${height * 0.3} ${width} ${height}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ ...style, overflow: "visible" }} aria-hidden="true">
      <defs>
        {/* Lit from the upper left, matching the soil rim; the low edges fade
            into the ground so the heap has no hard outline. */}
        <radialGradient id={`${uid}-m`} cx="40%" cy="10%" r="95%">
          <stop offset="0" stopColor="#87603d" />
          <stop offset="0.5" stopColor="#64432a" />
          <stop offset="1" stopColor="#4d321d" />
        </radialGradient>
        <linearGradient id={`${uid}-f`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.18" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.82" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${uid}-k`}><rect width={width} height={height} fill={`url(#${uid}-f)`} /></mask>
      </defs>
      <g mask={`url(#${uid}-k)`}>
      <path d={`${crest} Z`} fill={`url(#${uid}-m)`} />
      <circle cx={width * 0.32} cy={height * 0.62} r={Math.max(0.6, height * 0.09)} fill="#2c1a0d" opacity={0.55} />
      <circle cx={width * 0.64} cy={height * 0.5} r={Math.max(0.5, height * 0.07)} fill="#8a7058" opacity={0.7} />
      <circle cx={width * 0.78} cy={height * 0.78} r={Math.max(0.5, height * 0.08)} fill="#2c1a0d" opacity={0.45} />
      <path d={`${crest} Z`} fill="#0d0703" style={{ opacity: wet ? 0.28 : 0, transition: "opacity 1.2s" }} />
      </g>
    </svg>
  );
}

const SPARKLE_MS = 2400;

export function GardenBed({ plants, reduceMotion, raining = false, liveMinutes = 0, growing = false, className = "" }: {
  plants: GardenPlant[];
  reduceMotion: boolean;
  raining?: boolean; // breaks water the garden
  liveMinutes?: number; // focus minutes in the block running now, not yet recorded
  growing?: boolean; // the focus timer is running right now
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
  const growths = plants.map((p) => plantGrowth(p, liveMinutes));
  // Cropped glyph images (cached per emoji); null falls back to plain text.
  const sprites = useMemo(() => plants.map((p) => emojiSprite(p.emoji)), [plants]);

  // Sparkle a plant when the live block pushes it up a stage. Only live
  // stage-ups count: a fresh load or a sync just sets the baseline.
  const lastStage = useRef(new Map<string, number>());
  const [sparkle, setSparkle] = useState<Record<string, number>>({});
  const stageKey = growths.map((g, i) => `${plants[i]!.id}:${g.stage}`).join(",");
  useEffect(() => {
    const now = Date.now();
    const up: Record<string, number> = {};
    plants.forEach((p, i) => {
      const prev = lastStage.current.get(p.id);
      const cur = growths[i]!.stage;
      if (prev !== undefined && cur > prev && liveMinutes > 0) up[p.id] = now;
      lastStage.current.set(p.id, cur);
    });
    if (Object.keys(up).length === 0) return;
    setSparkle((s) => ({ ...s, ...up }));
    const t = window.setTimeout(() => setSparkle((s) => {
      const next = { ...s };
      for (const id of Object.keys(up)) if (next[id] === up[id]) delete next[id];
      return next;
    }), SPARKLE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the stage list
  }, [stageKey]);
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
          {/* Real ground: one textured strip of dirt per row (see SoilRows). */}
          <SoilRows rows={layout.rows} rowH={layout.rowH} soilH={layout.soilH} width={box.w} wet={raining} />

          <ul className="absolute inset-0 grid" style={{
            gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
            gridAutoRows: `${layout.rowH}px`,
          }}>
            {plants.map((p, i) => {
              // Seedling → full grown, scaled to whatever size fits the box.
              // Sized from overall progress rather than whole stages, so a
              // plant visibly grows minute by minute instead of in four jumps.
              const g = growths[i]!;
              const size = layout.size * (0.5 + 0.5 * g.overall);
              const full = g.toNext <= 0 && p.minutes !== null;
              // Centre a partial last row instead of leaving it hard left with
              // a long empty stretch of bed beside it.
              const lastRowCount = plants.length % layout.cols;
              const startsLastRow = lastRowCount > 0 && i === plants.length - lastRowCount;
              const sprite = sprites[i];
              // Cropped sprite: its bottom edge is the bottom of the plant, so
              // it stands exactly on the soil line instead of floating.
              const plantW = sprite ? sprite.w * size : size * 0.8;
              const plantH = sprite ? sprite.h * size : size;
              // The plant stands on the soil line; the mound in front hides
              // the cut-off base so it reads as growing out of the dirt.
              const moundW = Math.max(12, plantW * 0.72);
              const moundH = Math.max(4, Math.min(layout.soilH * 0.8, moundW * 0.24));
              const shadowW = Math.max(14, plantW * 0.95);
              const surface = layout.soilH; // distance from the row's bottom to the soil line
              return (
                <li key={p.id} className="relative"
                  style={{ gridColumnStart: startsLastRow ? Math.floor((layout.cols - lastRowCount) / 2) + 1 : undefined }}
                  title={`${p.name} — ${growthCaption(p, g)}`}>
                  {/* Contact shadow, cast down-right (light from upper left). */}
                  <span aria-hidden="true" className="garden-contact-shadow absolute left-1/2"
                    style={{ width: shadowW, height: Math.max(4, shadowW * 0.2), bottom: surface - Math.max(2, shadowW * 0.08), marginLeft: -shadowW / 2 + plantW * 0.08 }} />
                  <span aria-hidden="true" className={`absolute left-1/2 -translate-x-1/2 ${growing && !full && !reduceMotion ? "garden-growing" : ""}`}
                    style={{ bottom: surface - 1 }}>
                    {sprite ? (
                      <img src={sprite.src} alt="" draggable={false}
                        className={`garden-plant block max-w-none transition-[width,height] duration-700 ${reduceMotion ? "" : "garden-sway"}`}
                        style={{ width: plantW, height: plantH, animationDelay: `${(p.id.length % 5) * 0.4}s` }} />
                    ) : (
                      <span className={`inline-block transition-[font-size] duration-700 ${reduceMotion ? "" : "garden-sway"}`}
                        style={{ fontSize: `${size}px`, lineHeight: 1, animationDelay: `${(p.id.length % 5) * 0.4}s` }}>
                        {p.emoji}
                      </span>
                    )}
                    {sparkle[p.id] !== undefined && (
                      <span className={`absolute -right-2 -top-2 text-[11px] ${reduceMotion ? "" : "garden-sparkle"}`}>✨</span>
                    )}
                  </span>
                  {/* A little heap of dirt banked up in front of the stem, so the
                      plant reads as planted rather than set down on top. */}
                  <DirtMound width={moundW} height={moundH} wet={raining}
                    style={{ position: "absolute", left: "50%", marginLeft: -moundW / 2, bottom: surface - moundH * 0.55 }} />
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
        {plants.map((p, i) => <li key={p.id}>{p.name}, {growthCaption(p, growths[i]!)}</li>)}
      </ul>
      {raining && <p className="sr-only">Break time — your garden is getting watered.</p>}
    </div>
  );
}

// The big growth readout under the garden: one wide bar for the plant that's
// closest to its next stage (the next thing you'll see happen), with the block
// you're in shown as a striped live segment on top of what's already banked.
export function GardenGrowthBar({ plants, liveMinutes = 0, growing = false, className = "" }: {
  plants: GardenPlant[];
  liveMinutes?: number;
  growing?: boolean;
  className?: string;
}) {
  const timed = plants.filter((p) => p.minutes !== null);
  if (timed.length === 0) return null; // server without time-based growth
  const live = Math.max(0, liveMinutes);
  const rows = timed.map((p) => ({ p, now: plantGrowth(p, live), banked: plantGrowth(p, 0) }));
  const growingRows = rows.filter((r) => r.now.toNext > 0);
  const liveLine = live >= 1
    ? `${growing ? "🌱 Growing" : "⏸ Paused"} · +${fmtMinutes(Math.floor(live))} this block`
    : "Run the focus timer to grow your garden";

  if (growingRows.length === 0) {
    return (
      <div className={className} data-testid="garden-growth-bar">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold">🌳 Your garden is fully grown</span>
          <span className="text-muted-foreground">{fmtMinutes(Math.round(rows.reduce((m, r) => m + r.now.minutes, 0)))} grown</span>
        </div>
        <div className="mt-1.5 h-3.5 overflow-hidden rounded-full bg-amber-400" role="progressbar" aria-label="Garden fully grown" aria-valuemin={0} aria-valuemax={100} aria-valuenow={100} />
        <p className="mt-1 text-[11px] text-muted-foreground">Plant something new from your rewards to keep it growing.</p>
      </div>
    );
  }

  const next = growingRows.reduce((a, b) => (b.now.toNext < a.now.toNext ? b : a));
  const { p, now, banked } = next;
  // Banked part, then the live part. If the live block already pushed the
  // plant into a new stage, everything in this stage came from the block.
  const bankedPct = banked.stage === now.stage ? banked.progress * 100 : 0;
  const nowPct = now.progress * 100;
  const label = `${p.name} grows to ${growthLabel(now.stage + 1)} in ${fmtMinutes(Math.ceil(now.toNext))}`;
  return (
    <div className={className} data-testid="garden-growth-bar">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-semibold">
          <span aria-hidden="true">{p.emoji}</span> {p.name} <span className="font-normal text-muted-foreground">→ {growthLabel(now.stage + 1)}</span>
        </span>
        <span className="shrink-0 font-medium">{fmtMinutes(Math.ceil(now.toNext))} to go</span>
      </div>
      <div className="relative mt-1.5 h-3.5 overflow-hidden rounded-full bg-border" role="progressbar"
        aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(nowPct)}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-roamly-green transition-[width] duration-700" style={{ width: `${bankedPct.toFixed(1)}%` }} />
        {nowPct > bankedPct && (
          <div className="garden-live-fill absolute inset-y-0 rounded-r-full transition-[width] duration-700"
            style={{ left: `${bankedPct.toFixed(1)}%`, width: `${(nowPct - bankedPct).toFixed(1)}%`, minWidth: 8 }} />
        )}
      </div>
      <p className="mt-1 flex justify-between gap-2 text-[11px] text-muted-foreground">
        <span className={live >= 1 ? "font-medium text-roamly-green" : ""}>{liveLine}</span>
        {timed.length > 1 && <span className="shrink-0">{timed.length - growingRows.length}/{timed.length} full grown</span>}
      </p>
    </div>
  );
}
