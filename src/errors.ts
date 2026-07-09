// Client-side crash reporting without an external service. Uncaught errors,
// unhandled promise rejections, and React render crashes (via ErrorBoundary)
// are written to the client_errors table and surfaced in the admin dashboard —
// so production breakages show up somewhere the (non-technical) owner can see
// them, instead of only in a user's console. Fire-and-forget and heavily
// throttled; never throws, never blocks. Only signed-in sessions report
// (matches the telemetry model + RLS insert-own).

import { supabase } from "./supabaseClient";
import { currentTrackUser, deviceType, platformInfo } from "./track";

// De-dupe identical messages within a window so one repeating error can't
// flood the table.
const seen = new Map<string, number>();
const THROTTLE_MS = 60_000;

export function reportError(message: string, stack?: string, page?: string) {
  if (!supabase) return;
  const userId = currentTrackUser();
  if (!userId) return; // signed-out crashes aren't attributable under RLS
  const key = message.slice(0, 120);
  const now = Date.now();
  if (now - (seen.get(key) ?? 0) < THROTTLE_MS) return;
  seen.set(key, now);
  void supabase
    .from("client_errors")
    .insert({
      user_id: userId,
      message: message.slice(0, 500),
      stack: stack?.slice(0, 2000) ?? null,
      page: page ?? (typeof location !== "undefined" ? location.hash.replace("#", "") || "app" : null),
      device: deviceType(),
      platform: platformInfo().slice(0, 160),
    })
    .then(({ error }) => {
      if (error && !error.message.includes("does not exist")) {
        console.debug("[Roamly] error report skipped", error.message);
      }
    });
}

let installed = false;
export function initErrorCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    reportError(e.message || "window.error", (e.error as Error | undefined)?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    reportError(`Unhandled rejection: ${message}`, reason instanceof Error ? reason.stack : undefined);
  });
}
