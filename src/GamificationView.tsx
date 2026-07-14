// Garden tab — the free companions + leveling home:
//  * XP/level progress with a live preview of your active pets & plant
//  * Achievements (real, persistent — no longer Premium-gated)
//  * Pet collection, unlocked by completed study sessions
//  * Level rewards (plants, trees, pet cosmetics, themes)
//
// Signed-in users get authoritative state from the server and can pick which
// pet/plant is active; guests see a live local computation of their progress.

import { lazy, Suspense } from "react";
import { Sprout, PawPrint, Trophy, Lock, Check, Star, Sparkles } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { Modal } from "./Modal";
import { stageProps, type Gamification, type GamSyncResult } from "./gamification";
import { ACHIEVEMENT_CATALOG, PET_CATALOG, REWARD_CATALOG, PET_ART, GROWTH_STAGES, growthStage, type PetSpecies } from "./petCatalog";

const PetStage = lazy(() => import("./PetCanvas").then((m) => ({ default: m.PetStage })));

const KIND_LABEL: Record<string, string> = { plant: "Plant", tree: "Tree", accessory: "Accessory", theme: "Theme" };

export function GamificationView({ gamification, session, reduceMotion, onSignIn, onToggle, companionsOn, onToggleCompanions }: {
  gamification: Gamification;
  session: Session | null;
  reduceMotion: boolean;
  onSignIn: () => void;
  onToggle: (kind: "pet" | "reward", id: string, active: boolean) => void;
  companionsOn: boolean;
  onToggleCompanions: () => void;
}) {
  const g = gamification;
  const stage = stageProps(g);
  const span = Math.max(1, g.xp_for_next - g.xp_for_level);
  const within = Math.max(0, Math.min(1, (g.xp - g.xp_for_level) / span));
  const earnedAch = g.achievements.filter((a) => a.earned).length;
  const ownedPets = g.pets.filter((p) => p.owned).length;
  const canCustomize = !!session;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="flex items-center gap-2 font-display text-3xl font-semibold"><Sprout size={26} className="text-roamly-green" /> Garden</h1>
      <p className="mt-1 text-sm text-muted-foreground">Level up by studying. Earn pets, grow plants, and unlock rewards.</p>

      {/* Level + XP + live companion preview */}
      <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-11 w-11 place-items-center rounded-full gradient-primary font-display text-lg font-semibold text-white shadow-glow">{g.level}</span>
            <div>
              <p className="text-sm font-semibold">Level {g.level}</p>
              <p className="text-xs text-muted-foreground">{g.xp} XP · {g.sessions_completed} sessions</p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{Math.max(0, g.xp_for_next - g.xp)} XP to level {g.level + 1}</span>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full gradient-primary" style={{ width: `${within * 100}%`, transition: "width 1s ease" }} />
        </div>
        <div className="relative mt-4 h-28 overflow-hidden rounded-xl border border-border bg-secondary/40">
          {!companionsOn ? (
            <p className="grid h-full place-items-center text-xs text-muted-foreground">Companions are hidden on your timer.</p>
          ) : stage.pets.length > 0 || stage.plant ? (
            <Suspense fallback={null}>
              <PetStage pets={stage.pets} plant={stage.plant} asleep={false} reduceMotion={reduceMotion} className="absolute inset-0 h-full w-full" />
            </Suspense>
          ) : (
            <p className="grid h-full place-items-center text-xs text-muted-foreground">Your companions will appear here.</p>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">Show companions on your focus timer</p>
          <button role="switch" aria-checked={companionsOn} aria-label="Show companions on the timer" onClick={onToggleCompanions}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${companionsOn ? "bg-primary" : "bg-border"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${companionsOn ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>
        {!canCustomize && (
          <p className="mt-3 text-[11px] text-muted-foreground">Your progress is saved on this device only. <button onClick={onSignIn} className="font-medium text-primary underline-offset-2 hover:underline">Sign in</button> to keep it everywhere and customize your companions.</p>
        )}
      </div>

      {/* Achievements */}
      <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Trophy size={15} className="text-roamly-coral" /> Achievements</h2>
          <span className="text-xs text-muted-foreground">{earnedAch}/{g.achievements.length} earned</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {g.achievements.map((a) => (
            <div key={a.id} className={`rounded-xl border p-3 ${a.earned ? "border-primary/50 bg-primary/5" : "border-border bg-card/60 opacity-70"}`}>
              <div className="flex items-center gap-1.5">
                {a.earned ? <Check size={13} className="shrink-0 text-roamly-green" /> : <Lock size={12} className="shrink-0 text-muted-foreground" />}
                <span className="truncate text-xs font-semibold">{a.name}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{a.hint}</p>
              <p className="mt-1 text-[10px] font-medium text-primary">+{a.xp} XP</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pets */}
      <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><PawPrint size={15} className="text-roamly-purple" /> Companions</h2>
          <span className="text-xs text-muted-foreground">{ownedPets}/{g.pets.length} unlocked</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Everyone starts with a dog and a cat. Finish more study sessions to adopt the rest.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {g.pets.map((p) => {
            const emoji = PET_ART[p.species as PetSpecies]?.emoji ?? "🐾";
            const remaining = Math.max(0, p.unlock_sessions - g.sessions_completed);
            return (
              <div key={p.id} className={`flex items-center gap-3 rounded-xl border p-3 ${p.owned ? "border-border bg-card/60" : "border-border bg-card/40 opacity-70"}`}>
                <span className={`text-2xl ${p.owned ? "" : "grayscale"}`} aria-hidden="true">{emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{p.name}</p>
                  {p.owned ? (
                    canCustomize ? (
                      <button onClick={() => onToggle("pet", p.id, !p.is_active)}
                        className={`mt-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${p.is_active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                        {p.is_active ? "On timer ✓" : "Show on timer"}
                      </button>
                    ) : (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{p.is_active ? "On your timer" : "Unlocked"}</p>
                    )
                  ) : (
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground"><Lock size={9} /> {remaining} more session{remaining === 1 ? "" : "s"}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Level rewards */}
      <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Star size={15} className="text-roamly-blue" /> Level rewards</h2>
        <p className="mt-1 text-xs text-muted-foreground">Plants and trees grow as you study; cosmetics and themes unlock at new levels.</p>
        <div className="mt-3 space-y-1.5">
          {g.rewards.map((r) => {
            const growable = r.kind === "plant" || r.kind === "tree";
            const stg = growable ? growthStage(r.growth_points) : 0;
            return (
              <div key={r.id} className={`flex items-center gap-3 rounded-xl border p-2.5 ${r.owned ? "border-border bg-card/60" : "border-border bg-card/40 opacity-70"}`}>
                <span className={`text-xl ${r.owned ? "" : "grayscale"}`} aria-hidden="true">{r.meta.emoji ?? "🎁"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{r.name} <span className="font-normal text-muted-foreground">· {KIND_LABEL[r.kind] ?? r.kind}</span></p>
                  {r.owned && growable && (
                    <div className="mt-1 flex gap-0.5" aria-label={`Growth ${stg + 1} of ${GROWTH_STAGES}`}>
                      {Array.from({ length: GROWTH_STAGES }).map((_, i) => (
                        <span key={i} className={`h-1.5 w-4 rounded-full ${i <= stg ? "bg-roamly-green" : "bg-border"}`} />
                      ))}
                    </div>
                  )}
                </div>
                {r.owned ? (
                  growable && canCustomize ? (
                    <button onClick={() => onToggle("reward", r.id, !r.is_active)}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${r.is_active ? "bg-roamly-green/15 text-roamly-green" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                      {r.is_active ? "Growing ✓" : "Grow here"}
                    </button>
                  ) : (
                    <Check size={14} className="shrink-0 text-roamly-green" />
                  )
                ) : (
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Level {r.unlock_level}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Toast shown after a sync that unlocked something new.
const ACH_NAME = new Map(ACHIEVEMENT_CATALOG.map((a) => [a.id, a.name] as const));
const PET_NAME = new Map(PET_CATALOG.map((p) => [p.id, { name: p.name, emoji: PET_ART[p.species].emoji }] as const));
const REWARD_NAME = new Map(REWARD_CATALOG.map((r) => [r.id, { name: r.name, emoji: r.meta.emoji ?? "🎁" }] as const));

export function UnlockToast({ result, onClose }: { result: GamSyncResult; onClose: () => void }) {
  const rows: { emoji: string; label: string; sub: string }[] = [
    ...result.new_pets.map((id) => ({ emoji: PET_NAME.get(id)?.emoji ?? "🐾", label: PET_NAME.get(id)?.name ?? id, sub: "New companion" })),
    ...result.new_rewards.map((id) => ({ emoji: REWARD_NAME.get(id)?.emoji ?? "🎁", label: REWARD_NAME.get(id)?.name ?? id, sub: "Level reward" })),
    ...result.new_achievements.map((id) => ({ emoji: "🏆", label: ACH_NAME.get(id) ?? id, sub: "Achievement" })),
  ];
  if (rows.length === 0) return null;
  return (
    <Modal label="New unlocks" onClose={onClose} cardClassName="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl" testId="unlock-toast">
      <div className="p-5">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold"><Sparkles size={20} className="text-roamly-coral" /> Nice work!</h2>
        <p className="mt-1 text-sm text-muted-foreground">You just unlocked{rows.length > 1 ? ` ${rows.length} things` : ""}:</p>
        <div className="mt-4 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3">
              <span className="text-2xl" aria-hidden="true">{r.emoji}</span>
              <div><p className="text-sm font-semibold">{r.label}</p><p className="text-[11px] text-muted-foreground">{r.sub}</p></div>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="mt-5 w-full rounded-full gradient-primary py-2.5 text-sm font-semibold text-white shadow-glow">Awesome</button>
      </div>
    </Modal>
  );
}
