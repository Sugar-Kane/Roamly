// Featherweight usage tracking: signed-in users' feature events land in the
// app_events table (insert-own RLS; clients can never read them back — only
// the admin dashboard aggregates them via SECURITY DEFINER RPCs). Everything
// here is fire-and-forget and silent on failure: analytics must never break
// or slow the app. Signed-out usage isn't tracked at all.

import { supabase } from "./supabaseClient";

export type DeviceType = "phone" | "tablet" | "pc" | "unknown";

let cachedDevice: DeviceType | null = null;
export function deviceType(): DeviceType {
  if (cachedDevice) return cachedDevice;
  try {
    const ua = navigator.userAgent;
    const touch = navigator.maxTouchPoints > 1;
    // iPadOS reports a Mac UA but has touch; treat it as tablet.
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) cachedDevice = "tablet";
    else if (/iPhone|Android.+Mobile|Mobile.+Android/.test(ua)) cachedDevice = "phone";
    else if (/Android/.test(ua)) cachedDevice = "tablet";
    else cachedDevice = "pc";
  } catch {
    cachedDevice = "unknown";
  }
  return cachedDevice;
}

// Short browser/OS description attached to feedback so bugs are diagnosable.
export function platformInfo(): string {
  try {
    return `${window.screen.width}x${window.screen.height} · ${navigator.userAgent.slice(0, 120)}`;
  } catch {
    return "unknown";
  }
}

let trackedUser: string | null = null;
export function setTrackUser(userId: string | null) {
  trackedUser = userId;
}

// The signed-in user id, shared with the error reporter (errors.ts) so crash
// reports carry an account without duplicating the auth wiring.
export function currentTrackUser(): string | null {
  return trackedUser;
}

// Same-name events are throttled so e.g. rapid tab flipping logs once, not
// twenty times — the dashboard cares about "used the feature", not each tap.
const lastSent = new Map<string, number>();
const THROTTLE_MS = 30_000;

export function track(name: string, meta?: string) {
  if (!supabase || !trackedUser) return;
  const now = Date.now();
  const key = `${name}:${meta ?? ""}`;
  if (now - (lastSent.get(key) ?? 0) < THROTTLE_MS) return;
  lastSent.set(key, now);
  void supabase
    .from("app_events")
    .insert({ user_id: trackedUser, name, device: deviceType(), meta: meta?.slice(0, 80) ?? null })
    .then(({ error }) => {
      // Missing table (migration not applied yet) or offline — never surface.
      if (error && !error.message.includes("does not exist")) {
        console.debug("[Roamly] track skipped", error.message);
      }
    });
}
