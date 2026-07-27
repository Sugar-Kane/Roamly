// Session identity and device context.
//
// Two identifiers, deliberately separate:
//   sessionId — random per tab-session, never persisted. Groups one visit.
//   anonId    — persisted per device, ROTATED every 30 days. Lets us say
//               "affected 400 devices" without building a permanent profile,
//               and expires on its own so we never accumulate a durable
//               cross-device identity graph for signed-out visitors.
//
// userId is attached only when the app tells us who is signed in (App.tsx
// already does this for track.ts) — the SDK never reads auth storage itself.

import type { SessionContext } from "./types";

const ANON_KEY = "roamly-sh-anon";
const ANON_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Older Safari without randomUUID; still needs to be unguessable, so use
    // getRandomValues rather than Math.random.
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

function loadAnonId(): string {
  try {
    const raw = localStorage.getItem(ANON_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { id: string; at: number };
      if (parsed?.id && Date.now() - parsed.at < ANON_TTL_MS) return parsed.id;
    }
  } catch { /* private mode / disabled storage */ }
  const id = uuid();
  try {
    localStorage.setItem(ANON_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch { /* non-fatal: we just get a fresh id next load */ }
  return id;
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

function detectOs(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}

function detectDevice(ua: string): string {
  try {
    const touch = navigator.maxTouchPoints > 1;
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return "tablet";
    if (/iPhone|Android.+Mobile|Mobile.+Android/.test(ua)) return "phone";
    if (/Android/.test(ua)) return "tablet";
    return "pc";
  } catch {
    return "unknown";
  }
}

/** Current route, normalised. The app is hash-routed (`#/focus`). */
export function currentRoute(): string {
  try {
    const hash = location.hash.replace(/^#\/?/, "").split("?")[0];
    return (hash || location.pathname.replace(/^\//, "") || "home").slice(0, 40);
  } catch {
    return "unknown";
  }
}

let context: SessionContext | null = null;

export function initSession(): SessionContext {
  if (context) return context;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  context = {
    sessionId: uuid(),
    anonId: loadAnonId(),
    userId: null,
    // Vercel exposes the deploy SHA; without it the AI cannot correlate an
    // incident to a deploy, which is the single highest-value correlation.
    release: (import.meta.env.VITE_RELEASE as string | undefined) || "dev",
    environment: (import.meta.env.MODE as string | undefined) === "production" ? "production" : "development",
    device: detectDevice(ua),
    os: detectOs(ua),
    browser: detectBrowser(ua),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    locale: navigator.language || "unknown",
    timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "unknown"; } })(),
    isPremium: null,
    entryRoute: currentRoute(),
  };
  window.addEventListener("resize", () => {
    if (context) context.viewport = { w: window.innerWidth, h: window.innerHeight };
  }, { passive: true });
  return context;
}

export function getContext(): SessionContext | null {
  return context;
}

/**
 * The signed-in user's access token, held in memory ONLY and used solely as a
 * request header on the ingest call. It is never written into a payload, never
 * persisted, and never leaves this module by any other route.
 *
 * It exists because ingest refuses to trust a client-supplied user_id — it
 * derives identity from a verified JWT or records none at all. Without a token
 * on the wire that means every row is anonymous, which silently zeroes the
 * reach term of the priority score and the "affected users" figure.
 */
let authToken: string | null = null;

export function currentAuthToken(): string | null {
  return authToken;
}

/** Called by the app when auth state settles. */
export function identify(userId: string | null, isPremium: boolean | null, token?: string | null): void {
  if (!context) return;
  context.userId = userId;
  context.isPremium = isPremium;
  // `undefined` means "unchanged" so a caller that doesn't have the token to
  // hand cannot accidentally clear it; an explicit null signs out.
  if (token !== undefined) authToken = token;
  if (userId === null) authToken = null;
}

export { uuid };
