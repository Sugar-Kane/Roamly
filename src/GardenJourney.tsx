// "Your journey" — the Garden page's timeline of everything you've grown.
//
// A winding path (oldest at the bottom-left, newest at the top) where every
// study day sprouts a plant sized by its focus time, and every unlock —
// achievements, companions, plants, accessories, themes — stands on the day
// it was earned. Month signposts mark the turns of the calendar, and a From /
// To month range scopes the view.
//
// Layout is measured, not guessed: the card's width decides how many stops fit
// on a row, rows snake back and forth, and one SVG path is drawn through the
// row baselines with half-circle turns at the ends.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Gamification } from "./gamification";
import { ACHIEVEMENT_CATALOG, PET_ART, type AchievementCategory, type PetSpecies } from "./petCatalog";
import { dateKey, type FocusSession } from "./streaks";

type Stop =
  | { kind: "month"; date: string; label: string; year?: string }
  | { kind: "study"; date: string; minutes: number; emoji: string; scale: number }
  | { kind: "unlock"; date: string; emoji: string; label: string; what: string };

const CATEGORY_EMOJI: Record<AchievementCategory, string> = {
  focus: "⏱️", sessions: "🔁", consistency: "🔥", tasks: "✅", social: "👥",
};
const ACH_CATEGORY = new Map(ACHIEVEMENT_CATALOG.map((a) => [a.id, a.category] as const));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A study day's plant: more focus time grows a bigger, leafier plant. The
// species within a tier is picked from the date so the forest has variety but
// never reshuffles between renders.
const TIERS: { min: number; plants: string[]; scale: number }[] = [
  { min: 240, plants: ["🌳", "🌸", "🌲"], scale: 1.15 },
  { min: 120, plants: ["🌳", "🌲", "🌴"], scale: 1 },
  { min: 60, plants: ["🌿", "🌷", "🌻"], scale: 0.85 },
  { min: 25, plants: ["🌱", "🌼", "☘️"], scale: 0.72 },
  { min: 0, plants: ["🌱"], scale: 0.6 },
];
function studyPlant(date: string, minutes: number) {
  const tier = TIERS.find((t) => minutes >= t.min)!;
  const seed = [...date].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return { emoji: tier.plants[seed % tier.plants.length]!, scale: tier.scale };
}

const monthKey = (d: string) => d.slice(0, 7); // "YYYY-MM"
const fmtMonth = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]} '${k.slice(2, 4)}`;
const fmtDay = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
const fmtHours = (m: number) => (m < 60 ? `${m} min` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`);
const localDay = (iso: string) => dateKey(new Date(iso));

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4)), tm = Number(to.slice(5, 7));
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function GardenJourney({ gamification, sessions }: { gamification: Gamification; sessions: FocusSession[] }) {
  // Every dated event, oldest first.
  const { studyDays, unlocks } = useMemo(() => {
    const studyDays = new Map<string, number>();
    for (const s of sessions) if (s.minutes > 0) studyDays.set(s.date, (studyDays.get(s.date) ?? 0) + s.minutes);
    const unlocks: Extract<Stop, { kind: "unlock" }>[] = [];
    for (const a of gamification.achievements) {
      if (!a.earned || !a.earned_at) continue;
      unlocks.push({ kind: "unlock", date: localDay(a.earned_at), emoji: CATEGORY_EMOJI[ACH_CATEGORY.get(a.id) ?? "focus"], label: a.name, what: "Achievement" });
    }
    for (const p of gamification.pets) {
      if (!p.owned || !p.earned_at) continue;
      unlocks.push({ kind: "unlock", date: localDay(p.earned_at), emoji: PET_ART[p.species as PetSpecies]?.emoji ?? "🐾", label: p.name, what: "Companion" });
    }
    for (const r of gamification.rewards) {
      if (!r.owned || !r.earned_at) continue;
      const what = r.kind === "plant" ? "Plant" : r.kind === "tree" ? "Tree" : r.kind === "theme" ? "Theme" : "Accessory";
      unlocks.push({ kind: "unlock", date: localDay(r.earned_at), emoji: r.meta.emoji ?? "🎁", label: r.name, what });
    }
    unlocks.sort((a, b) => a.date.localeCompare(b.date));
    return { studyDays, unlocks };
  }, [gamification, sessions]);

  const today = dateKey(new Date());
  const allDates = [...studyDays.keys(), ...unlocks.map((u) => u.date)].sort();
  const firstMonth = monthKey(allDates[0] ?? today);
  const months = useMemo(() => monthsBetween(firstMonth, monthKey(today)), [firstMonth, today]);
  // Default: the last four months (or everything, if that's less).
  const [from, setFrom] = useState(() => months[Math.max(0, months.length - 4)]!);
  const [to, setTo] = useState(() => months[months.length - 1]!);
  const lo = from <= to ? from : to, hi = from <= to ? to : from;

  const stops = useMemo(() => {
    const inRange = (d: string) => monthKey(d) >= lo && monthKey(d) <= hi;
    const byDay = new Map<string, Stop[]>();
    const add = (d: string, s: Stop) => { const l = byDay.get(d); if (l) l.push(s); else byDay.set(d, [s]); };
    for (const [d, min] of studyDays) if (inRange(d)) add(d, { kind: "study", date: d, minutes: min, ...studyPlant(d, min) });
    for (const u of unlocks) if (inRange(u.date)) add(u.date, u);
    const out: Stop[] = [];
    let lastMonth = "", lastYear = "";
    for (const d of [...byDay.keys()].sort()) {
      const mk = monthKey(d);
      if (mk !== lastMonth) {
        const year = d.slice(0, 4);
        out.push({ kind: "month", date: d, label: MONTHS[Number(d.slice(5, 7)) - 1]!, year: lastYear && year !== lastYear ? year : undefined });
        lastMonth = mk;
        lastYear = year;
      }
      out.push(...byDay.get(d)!);
    }
    return out;
  }, [studyDays, unlocks, lo, hi]);

  const totals = useMemo(() => {
    let days = 0, minutes = 0, got = 0;
    for (const s of stops) {
      if (s.kind === "study") { days++; minutes += s.minutes; }
      if (s.kind === "unlock") got++;
    }
    return { days, minutes, got };
  }, [stops]);

  // Measure the card to fit stops per row.
  const boxRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setW(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [lo, hi]);

  // Denser on phones so a few months still reads as a forest, not a ladder.
  const narrow = w > 0 && w < 520;
  const CELL = narrow ? 40 : 46, ROW_H = narrow ? 62 : 74, TURN = ROW_H / 2, PAD_Y = 28;
  const PLANT = narrow ? 26 : 30;
  const usable = Math.max(0, w - TURN * 2 - 8);
  const perRow = Math.max(3, Math.floor(usable / CELL));
  const rows: Stop[][] = [];
  for (let i = 0; i < stops.length; i += perRow) rows.push(stops.slice(i, i + perRow));
  const height = rows.length * ROW_H + PAD_Y * 2;
  const x0 = TURN + 4, x1 = w - TURN - 4;
  // Row 0 (oldest) sits at the bottom; even rows run left→right, odd rows back.
  const baseY = (r: number) => height - PAD_Y - r * ROW_H;
  let path = "";
  rows.forEach((_, r) => {
    const y = baseY(r);
    const ltr = r % 2 === 0;
    if (r === 0) path += `M ${x0} ${y} `;
    path += `L ${ltr ? x1 : x0} ${y} `;
    if (r < rows.length - 1) path += `A ${TURN} ${TURN} 0 0 ${ltr ? 0 : 1} ${ltr ? x1 : x0} ${y - ROW_H} `;
  });
  const lastLtr = (rows.length - 1) % 2 === 0;
  const endX = lastLtr ? x1 : x0, endY = baseY(rows.length - 1);

  const describe = (s: Stop): string =>
    s.kind === "study" ? `${fmtDay(s.date)} · ${fmtHours(s.minutes)} of focus`
      : s.kind === "unlock" ? `${fmtDay(s.date)} · Unlocked ${s.label} (${s.what})`
        : `${s.label} ${s.date.slice(0, 4)}`;
  const pickedStop = picked !== null ? stops[picked] : null;

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm" data-testid="garden-journey">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">🌳 Your journey</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Every study day grows a plant — more focus, bigger plant — and every unlock stands on the day you earned it.</p>
        </div>
        <div className="flex items-end gap-3 text-xs">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">From</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1">
              {months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">To</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border bg-card px-2 py-1">
              {months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* The board scrolls inside a fixed window: it opens on your latest
          days (newest is at the top) and scrolling down walks back in time. */}
      <div className="mt-3 max-h-[560px] overflow-y-auto overscroll-contain rounded-xl" data-testid="journey-scroll">
      <div ref={boxRef} className="journey-board relative overflow-hidden" style={{ height: rows.length ? height : 140 }}>
        {rows.length === 0 ? (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-white/70">
            Nothing grew in this range yet — run a focus block and your first plant takes root here.
          </p>
        ) : w > 0 && (
          <>
            <svg className="absolute inset-0" width={w} height={height} aria-hidden="true">
              <path d={path} fill="none" stroke="#b9773c" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
              <path d={path} fill="none" stroke="#e0a25e" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={x0} cy={baseY(0)} r={8} fill="#e0a25e" stroke="#b9773c" strokeWidth={2} />
              {/* The arrow points where you're headed next. */}
              <path d={lastLtr
                ? `M ${endX + 2} ${endY - 9} L ${endX + 16} ${endY} L ${endX + 2} ${endY + 9} Z`
                : `M ${endX - 2} ${endY - 9} L ${endX - 16} ${endY} L ${endX - 2} ${endY + 9} Z`} fill="#e0a25e" stroke="#b9773c" strokeWidth={2} strokeLinejoin="round" />
            </svg>
            <ul className="absolute inset-0">
              {rows.flatMap((row, r) => row.map((s, i) => {
                const idx = r * perRow + i;
                const ltr = r % 2 === 0;
                // Snake: even rows fill left→right, odd rows right→left, so the
                // order reads continuously around each turn.
                const slot = ltr ? i : perRow - 1 - i;
                const cx = x0 + ((x1 - x0) / perRow) * (slot + 0.5);
                const y = baseY(r);
                const active = picked === idx;
                const common = {
                  style: { left: cx, top: y } as CSSProperties,
                  title: describe(s),
                  "aria-label": describe(s),
                };
                if (s.kind === "month") {
                  return (
                    <li key={idx} {...common} className="absolute -translate-x-1/2 -translate-y-full">
                      <span className="flex flex-col items-center">
                        <span className="rounded-md bg-[#f3e6c9] px-1.5 py-0.5 text-center text-[10px] font-semibold leading-tight text-[#5b3d22] shadow">
                          {s.year && <span className="block">{s.year}</span>}{s.label}
                        </span>
                        <span className="h-3 w-[3px] bg-[#8a6a48]" />
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={idx} {...common} className="absolute -translate-x-1/2 -translate-y-full">
                    <button type="button" onClick={() => setPicked(active ? null : idx)} aria-label={describe(s)} aria-pressed={active}
                      className={`flex flex-col items-center rounded-lg px-0.5 outline-none transition focus-visible:ring-2 focus-visible:ring-white/70 ${active ? "bg-white/15" : ""}`}>
                      {s.kind === "unlock" ? (
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#f3e6c9] text-lg shadow ring-2 ring-amber-300/80">{s.emoji}</span>
                      ) : (
                        <span className="leading-none" style={{ fontSize: `${Math.round(PLANT * s.scale)}px` }}>{s.emoji}</span>
                      )}
                      <span className="h-1.5" />
                    </button>
                  </li>
                );
              }))}
            </ul>
          </>
        )}
      </div>
      </div>

      <p className="mt-2 min-h-[1.25rem] text-[11px] text-muted-foreground" aria-live="polite">
        {pickedStop ? <span className="font-medium text-foreground">{describe(pickedStop)}</span>
          : <>{fmtMonth(lo)} – {fmtMonth(hi)}: <span className="font-medium text-foreground">{totals.days}</span> study day{totals.days === 1 ? "" : "s"} · <span className="font-medium text-foreground">{fmtHours(totals.minutes)}</span> of focus · <span className="font-medium text-foreground">{totals.got}</span> unlock{totals.got === 1 ? "" : "s"}. Tap anything on the path for details.</>}
      </p>
    </div>
  );
}
