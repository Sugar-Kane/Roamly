// Feature flags — the fastest remediation the platform has.
//
// Shipping a fix takes minutes at best (CI, review, deploy). Turning a broken
// feature off takes one round trip and reaches every user on their next flag
// refresh. So the flag system is part of the self-healing loop, not a separate
// product concern: sh_sweep_flag_rollback() flips flags automatically when a
// feature's error rate crosses its threshold.
//
// Evaluation is LOCAL and SYNCHRONOUS after the initial fetch — a flag check
// must never be able to make a render await a network call, and must never
// fail closed in a way that hides a working feature. Unknown flag → enabled,
// because the failure mode of "flag service is down so nothing works" is worse
// than the failure mode of "flag service is down so a broken feature stays on
// for one more minute".

import type { FlagState } from "./types";
import { supabase } from "../supabaseClient";
import { getContext } from "./session";

const CACHE_KEY = "roamly-sh-flags";
const REFRESH_MS = 60_000;

let flags: Record<string, FlagState> = {};
let loaded = false;
let timer: number | null = null;

/** FNV-1a — small, fast, and stable across browsers, unlike hashCode idioms. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic bucket in [0,100). Hashing (flagKey + anonId) rather than
 * anonId alone means a user in the first 10% of one rollout is not
 * automatically in the first 10% of every rollout — otherwise the same
 * unlucky cohort would receive every experimental feature.
 */
function bucket(key: string, id: string): number {
  return hash(`${key}:${id}`) % 100;
}

function readCache(): Record<string, FlagState> {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, FlagState>) : {};
  } catch {
    return {};
  }
}

function writeCache(next: Record<string, FlagState>): void {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

export async function refreshFlags(): Promise<void> {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.rpc("sh_public_flags");
    if (error || !data) return;
    const next: Record<string, FlagState> = {};
    for (const row of data as Record<string, unknown>[]) {
      next[String(row.key)] = {
        key: String(row.key),
        enabled: Boolean(row.enabled),
        rolloutPercent: Number(row.rollout_percent ?? 100),
        premiumOnly: Boolean(row.premium_only),
        betaOnly: Boolean(row.beta_only),
        regions: (row.regions as string[] | null) ?? null,
      };
    }
    flags = next;
    loaded = true;
    writeCache(next);
  } catch { /* keep the previous snapshot */ }
}

export function initFlags(): void {
  flags = readCache();
  void refreshFlags();
  if (timer === null && typeof window !== "undefined") {
    timer = window.setInterval(() => { void refreshFlags(); }, REFRESH_MS);
    // A tab returning to the foreground should pick up a kill switch that was
    // thrown while it was hidden, without waiting out the interval.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refreshFlags();
    });
  }
}

/** Synchronous evaluation. Safe to call in render. */
export function isEnabled(key: string): boolean {
  const flag = flags[key];
  // Fail OPEN for unknown flags (see header). A flag that has been fetched and
  // says false, however, is authoritative.
  if (!flag) return true;
  if (!flag.enabled) return false;

  const ctx = getContext();
  if (flag.premiumOnly && ctx?.isPremium !== true) return false;
  if (flag.rolloutPercent >= 100) return true;
  if (flag.rolloutPercent <= 0) return false;
  const id = ctx?.userId || ctx?.anonId || "anon";
  return bucket(key, id) < flag.rolloutPercent;
}

/** Snapshot of the flags active for this session, stamped onto sh_sessions. */
export function activeFlagState(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(flags)) out[key] = isEnabled(key);
  return out;
}

export function flagsLoaded(): boolean {
  return loaded;
}
