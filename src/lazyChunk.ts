// Deploy-safe lazy loading.
//
// A Vercel deploy replaces every hashed asset. Roamly is a long-session app —
// people leave the timer open for hours — so a tab opened before a deploy is
// holding a module graph whose chunks no longer exist. The moment such a tab
// navigates to something code-split (the admin dashboard, the charts, the pet
// canvas) the dynamic import fetches a URL that now 404s, and the user gets a
// crashed screen instead of the page they asked for.
//
// This is not hypothetical: it produced three incidents in one second —
// a React crash reading 'default' of undefined, a window.error, and a failed
// POST of the error report itself — from a build (index-DI4GPqCB.js) that had
// already been replaced.
//
// The failure has two shapes and both are handled here:
//   * the import REJECTS — the ordinary "Failed to fetch dynamically imported
//     module" / "Loading chunk failed" case, and
//   * the import RESOLVES to something with no usable `default`, which is what
//     actually reached production. React.lazy then reads `.default` off
//     undefined and throws inside render, where a try/catch around the import
//     would never have seen it.
//
// Recovery is a reload, because a stale tab cannot be repaired in place: the
// fix is new HTML pointing at asset hashes that exist. The guard below is the
// important part — a reload that fails the same way must not reload again, or
// a genuinely broken deploy becomes an infinite refresh loop for every user.

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOAD_KEY = "roamly-chunk-reload-at";
// Long enough to cover a slow reload, short enough that a stale-chunk failure
// hours later is still treated as fresh and gets its one recovery attempt.
const RELOAD_WINDOW_MS = 20_000;

function reloadedRecently(): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    return Number.isFinite(at) && Date.now() - at < RELOAD_WINDOW_MS;
  } catch {
    // Private mode / blocked storage: no way to remember, so never auto-reload.
    // Surfacing the error beats risking a loop we cannot detect.
    return true;
  }
}

function markReloaded(): void {
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* nothing to do */ }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;
type Loaded<T extends AnyComponent> = { default: T };

function usable<T extends AnyComponent>(mod: unknown): mod is Loaded<T> {
  return !!mod && typeof mod === "object" && typeof (mod as Loaded<T>).default !== "undefined";
}

/**
 * Drop-in replacement for React.lazy that survives a deploy.
 *
 * One retry first: a single failed request is more often a network blip than a
 * missing chunk, and retrying costs nothing when the asset is really gone.
 * Only then does it reload, and only once per window.
 */
export function lazyChunk<T extends AnyComponent>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await factory();
      if (usable<T>(mod)) return mod;
      throw new Error("dynamic import resolved without a usable default export");
    } catch (error) {
      try {
        const retry = await factory();
        if (usable<T>(retry)) return retry;
      } catch { /* second failure — treat as a stale chunk */ }

      if (!reloadedRecently()) {
        markReloaded();
        window.location.reload();
        // Deliberately never settles. Resolving anything here would render it
        // for a frame before the reload lands; rejecting would flash the error
        // boundary at a user who is about to get a working page. Suspense holds
        // its fallback until navigation takes over.
        return new Promise<Loaded<T>>(() => {});
      }
      // Already reloaded and still broken: this is not deploy churn. Let it
      // reach the error boundary rather than refreshing forever.
      throw error;
    }
  });
}
