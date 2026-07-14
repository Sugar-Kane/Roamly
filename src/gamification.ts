// Gamification data layer: leveling, achievements, pets & rewards.
//
// Signed-in users read authoritative state from the get_my_gamification RPC and
// advance it with sync_my_gamification (both defined in release_11). Guest
// (signed-out / no-Supabase) mode computes the same shape locally from the
// browser's focus history, so the Garden works offline too — matching how the
// rest of the app degrades when `supabase` is null.

import { supabase } from "./supabaseClient";
import type { StudyEvent } from "./release3";
import { type FocusSession, computeStreak } from "./streaks";
import {
  ACHIEVEMENT_CATALOG, PET_CATALOG, REWARD_CATALOG,
  earnedAchievementIds, growthStage, type RewardKind, type StudyMetrics,
} from "./petCatalog";

export type GamAchievement = { id: string; name: string; hint: string; xp: number; sort: number; earned: boolean; earned_at: string | null };
export type GamPet = { id: string; species: string; name: string; unlock_sessions: number; sort: number; owned: boolean; is_active: boolean };
export type GamReward = { id: string; kind: RewardKind; name: string; unlock_level: number; meta: { emoji?: string }; sort: number; owned: boolean; is_active: boolean; growth_points: number };

export type Gamification = {
  xp: number;
  level: number;
  sessions_completed: number;
  xp_for_level: number;
  xp_for_next: number;
  stats_public: boolean;
  achievements: GamAchievement[];
  pets: GamPet[];
  rewards: GamReward[];
};

export type GamSyncResult = {
  xp: number;
  level: number;
  sessions_completed: number;
  new_achievements: string[];
  new_pets: string[];
  new_rewards: string[];
};

// The active pets + active plant/tree to draw on the companion stage (shared by
// the Garden preview and the timer overlay).
export function stageProps(g: Gamification): { pets: { id: string; species: string }[]; plant: { emoji: string; stage: number } | null } {
  const pets = g.pets.filter((p) => p.owned && p.is_active).map((p) => ({ id: p.id, species: p.species }));
  const active = g.rewards.find((r) => r.owned && r.is_active && (r.kind === "plant" || r.kind === "tree"));
  const plant = active ? { emoji: active.meta.emoji ?? "🌱", stage: growthStage(active.growth_points) } : null;
  return { pets, plant };
}

// XP curve — mirrors public.level_for_xp / public.xp_for_level in the migration.
export const levelForXp = (xp: number): number => Math.max(1, Math.floor(Math.sqrt(Math.max(xp, 0) / 50)) + 1);
export const xpForLevel = (level: number): number => (Math.max(level, 1) - 1) ** 2 * 50;

// Per-session activity XP with the group multiplier (>1 only for room sessions).
const GROUP_MULTIPLIER_CAP = 3;
export const groupMultiplier = (groupSize: number): number => Math.min(GROUP_MULTIPLIER_CAP, 1 + 0.25 * (Math.max(1, groupSize) - 1));
const BASE_SESSION_XP = 10;

/** Full gamification state for a signed-in user, or null if Supabase is off. */
export async function fetchGamification(): Promise<Gamification | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_my_gamification");
  if (error || !data) { console.warn("[Roamly] fetchGamification failed", error?.message); return null; }
  return data as Gamification;
}

/** Recompute & award; returns what was newly unlocked (for popups), or null. */
export async function syncGamification(): Promise<GamSyncResult | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("sync_my_gamification");
  if (error || !data) { console.warn("[Roamly] syncGamification failed", error?.message); return null; }
  return data as GamSyncResult;
}

/** Enable/disable public stat sharing. Returns an error message, or null on success. */
export async function setStatsPublic(pub: boolean): Promise<string | null> {
  if (!supabase) return "Stats sharing isn't available right now.";
  const { error } = await supabase.rpc("set_stats_public", { p_public: pub });
  if (!error) return null;
  if (error.message.includes("premium_required")) return "Public sharing is a Premium feature.";
  console.warn("[Roamly] setStatsPublic failed", error.message);
  return "Couldn't update sharing — try again.";
}

/** Toggle which pet is shown on the timer. */
export async function setPetActive(petId: string, active: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("user_pets").update({ is_active: active }).eq("pet_id", petId);
  if (error) { console.warn("[Roamly] setPetActive failed", error.message); return false; }
  return true;
}

/** Choose which plant/tree is growing in the garden. */
export async function setRewardActive(rewardId: string, active: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("user_rewards").update({ is_active: active }).eq("reward_id", rewardId);
  if (error) { console.warn("[Roamly] setRewardActive failed", error.message); return false; }
  return true;
}

// ---- Guest mode: compute the same shape locally ----

function metricsFrom(sessions: FocusSession[], events: StudyEvent[], doneTasks: number): StudyMetrics {
  const totalMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
  const bestDayMinutes = sessions.reduce((max, s) => Math.max(max, s.minutes), 0);
  return {
    totalMinutes,
    bestDayMinutes,
    streak: computeStreak(sessions),
    sessionCount: events.length,
    doneTasks,
    hasRoomSession: events.some((e) => e.session_kind === "room"),
  };
}

/**
 * Compute gamification state from local history for guest mode. Pets are auto-
 * activated (dog + earliest owned plant) to match sync_my_gamification's
 * starter defaults. Group sessions don't happen while signed-out, so activity
 * XP uses the base rate.
 */
export function computeLocalGamification(sessions: FocusSession[], events: StudyEvent[], doneTasks: number): Gamification {
  const m = metricsFrom(sessions, events, doneTasks);
  const earned = earnedAchievementIds(m);
  const achievements: GamAchievement[] = ACHIEVEMENT_CATALOG.map((a) => ({
    ...a, earned: earned.has(a.id), earned_at: null,
  }));
  const achXp = ACHIEVEMENT_CATALOG.reduce((sum, a) => sum + (earned.has(a.id) ? a.xp : 0), 0);
  const activityXp = Math.round(events.reduce((sum, e) => sum + BASE_SESSION_XP * groupMultiplier((e as { group_size?: number }).group_size ?? 1), 0));
  const xp = achXp + activityXp;
  const level = levelForXp(xp);

  const pets: GamPet[] = PET_CATALOG.map((p) => ({
    ...p, owned: p.unlock_sessions <= m.sessionCount, is_active: p.id === "dog",
  }));

  const owned = REWARD_CATALOG.filter((r) => r.unlock_level <= level);
  const firstPlant = owned.find((r) => r.kind === "plant" || r.kind === "tree");
  const rewards: GamReward[] = REWARD_CATALOG.map((r) => {
    const isOwned = r.unlock_level <= level;
    const isActivePlant = firstPlant?.id === r.id;
    return {
      ...r, owned: isOwned, is_active: isActivePlant,
      growth_points: isActivePlant ? m.sessionCount : 0,
    };
  });

  return {
    xp, level, sessions_completed: m.sessionCount,
    xp_for_level: xpForLevel(level), xp_for_next: xpForLevel(level + 1),
    stats_public: false, achievements, pets, rewards,
  };
}
