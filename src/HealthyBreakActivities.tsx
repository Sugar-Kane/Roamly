import { useEffect, useMemo, useState } from "react";
import { Check, Heart } from "lucide-react";
import { loadPref, savePref } from "./storage";

export type Activity = { id: string; title: string; instruction: string; category: string; movement: boolean };
const ACTIVITIES: Activity[] = [
  { id: "water", title: "Drink water", instruction: "Take a few comfortable sips.", category: "hydrate", movement: false },
  { id: "stand", title: "Stand up", instruction: "Change position for a moment, with support if needed.", category: "movement", movement: true },
  { id: "back", title: "Gentle back stretch", instruction: "Lengthen your spine without pushing into discomfort.", category: "mobility", movement: true },
  { id: "eyes", title: "Rest your eyes", instruction: "Look at something far away and soften your focus.", category: "rest", movement: false },
  { id: "breathe", title: "Slow breaths", instruction: "Take three slow, comfortable breaths.", category: "reset", movement: false },
  { id: "walk", title: "Brief walk", instruction: "Walk for a minute if your space and mobility allow.", category: "movement", movement: true },
  { id: "squat", title: "A few squats", instruction: "Do a few gentle squats if your body's up for it. Hold a chair for support.", category: "movement", movement: true },
  { id: "posture", title: "Reset posture", instruction: "Let your shoulders relax and place both feet comfortably.", category: "mobility", movement: false },
  { id: "hands", title: "Relax your hands", instruction: "Unclench your hands and gently move your fingers.", category: "mobility", movement: false },
];

// Two activities per break, keyed off breakKey (deterministic within a break,
// different next break) and excluding the previous break's picks. Shared by
// the standalone break card and the focus-mode task checklist, so every
// surface that's mounted during the same break shows the same pair.
export function useBreakActivityPicks(active: boolean, breakKey: string): Activity[] {
  const picks = useMemo(() => {
    if (!active) return [];
    const previous = (loadPref("roamly-break-activity-last") ?? "").split(",").filter(Boolean);
    let hash = 0; for (const c of breakKey) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
    const pool = ACTIVITIES.filter((a) => !previous.includes(a.id));
    const source = pool.length >= 2 ? pool : ACTIVITIES;
    const first = Math.abs(hash) % source.length;
    const second = (first + 1 + Math.abs(hash >> 3) % (source.length - 1)) % source.length;
    return [source[first], source[second]];
  }, [active, breakKey]);

  useEffect(() => {
    if (picks.length) savePref("roamly-break-activity-last", picks.map((p) => p.id).join(","));
  }, [picks]);
  return picks;
}

export function HealthyBreakActivities({ active, breakKey, compact = false }: { active: boolean; breakKey: string; compact?: boolean }) {
  const [completed, setCompleted] = useState<string[]>([]);
  const picks = useBreakActivityPicks(active, breakKey);

  useEffect(() => { setCompleted([]); }, [breakKey]);
  if (!active || picks.length !== 2) return null;
  // Checking an activity removes it from the list; the card hides once both
  // are done (or dismissed).
  const remaining = picks.filter((a) => !completed.includes(a.id));
  if (remaining.length === 0) return null;

  return <section className={`rounded-2xl border border-roamly-green/30 bg-roamly-green/5 ${compact ? "p-3" : "p-4"}`} aria-label="Healthy break activities">
    <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Heart size={14} className="text-roamly-green" /> Optional break reset</h2>
    <p className="mt-0.5 text-[11px] text-muted-foreground">Check one off to clear it, or ignore them. Your timer keeps going.</p>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {remaining.map((activity) => (
        <button key={activity.id} onClick={() => setCompleted((v) => [...v, activity.id])}
          aria-label={`Mark ${activity.title} done`}
          className="group/act rounded-xl border border-border bg-card/70 p-3 text-left transition hover:border-roamly-green/50">
          <span className="flex items-center gap-1.5 text-xs font-semibold">
            <Check size={13} className="text-roamly-green opacity-0 transition-opacity group-hover/act:opacity-60" />{activity.title}
          </span>
          <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{activity.instruction}</span>
        </button>
      ))}
    </div>
  </section>;
}
