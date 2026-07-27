// Public entry point for the self-healing SDK.
//
// One import, one call:
//
//   import { initSelfHealing } from "./selfheal";
//   initSelfHealing();
//
// Everything else in this folder is internal. App code touches exactly three
// things: `expect()` to declare a feature outcome, `startJourney`/`journeyStep`
// to trace a multi-step flow, and `isEnabled()` to check a flag.
//
// Failure policy: initialisation is wrapped end to end. If any part of the SDK
// throws on boot, the app boots anyway without telemetry. Monitoring that can
// take down the product it monitors is worse than no monitoring.

import { initSession, identify } from "./session";
import { startTransport, flush } from "./transport";
import { installSensors } from "./sensors";
import { installReplay, forceReplay } from "./replay";
import { initFlags, isEnabled } from "./flags";
import { resumeJourneys } from "./journeys";
import { settleAllForUnload } from "./outcomes";

let booted = false;

export type SelfHealingOptions = {
  /** Fraction of sessions that record an interaction trace. */
  replaySampleRate?: number;
  /** Set false in tests/local dev to keep the queue local. */
  enabled?: boolean;
};

export function initSelfHealing(options: SelfHealingOptions = {}): void {
  if (booted || typeof window === "undefined") return;
  booted = true;
  try {
    const { replaySampleRate = 0.25, enabled = true } = options;
    if (!enabled) return;

    initSession();
    initFlags();

    // The master kill switch. If telemetry itself starts causing problems,
    // flipping sh_flags.selfheal.telemetry stops all collection within a
    // minute without a deploy. Checked after initFlags() so the cached
    // snapshot from the previous page load applies immediately.
    if (!isEnabled("selfheal.telemetry")) return;

    startTransport();
    installSensors();
    if (isEnabled("selfheal.replay")) installReplay(replaySampleRate);
    resumeJourneys();

    // Outcomes still open when the page goes away are settled and flushed with
    // the final beacon; otherwise every abandonment would be invisible.
    window.addEventListener("pagehide", () => {
      try { settleAllForUnload(); } catch { /* ignore */ }
      void flush(true);
    });
  } catch {
    // Swallow: a broken SDK must not be able to break the app.
  }
}

/** Called by the app when auth state settles, mirroring setTrackUser(). */
export function identifySelfHealing(userId: string | null, isPremium: boolean | null): void {
  try { identify(userId, isPremium); } catch { /* ignore */ }
}

export { expect } from "./outcomes";
export type { OutcomeHandle } from "./outcomes";
export { startJourney, journeyStep, cancelJourney } from "./journeys";
export { isEnabled, refreshFlags, activeFlagState } from "./flags";
export { reportReactCrash } from "./sensors";
export { forceReplay };
export { flush as flushTelemetry };
export type { FeatureContract, JourneyDefinition, Severity } from "./types";
export { CONTRACT_LIST, JOURNEY_LIST } from "./contracts";
