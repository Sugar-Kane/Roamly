import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Did this page load come from an invite/recovery email link? Must be read
// here, before createClient below — Supabase's detectSessionInUrl consumes and
// strips the #access_token=…&type=invite hash shortly after initialization.
export const arrivedViaEmailLink =
  typeof window !== "undefined" && /type=(invite|recovery)/.test(window.location.hash);

export const supabaseEnabled = Boolean(url && anonKey);

if (!supabaseEnabled) {
  console.warn(
    "[Roamly] Supabase env vars are missing. Accounts, sync, and payments are disabled. " +
    "The app runs in local-only demo mode until VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set."
  );
}

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url as string, anonKey as string)
  : null;

// A stored browser session can outlive a server-side account deletion until its
// JWT naturally expires. Validate persisted sessions against Supabase Auth when
// the app starts and whenever the user returns to the tab. If Auth says the user
// no longer exists, clear only this device's cached session immediately.
if (supabase && typeof window !== "undefined") {
  const client = supabase;
  let validationInFlight: Promise<void> | null = null;

  const validateStoredSession = (): Promise<void> => {
    if (validationInFlight) return validationInFlight;
    validationInFlight = (async () => {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData.session) return;

      const { data: userData, error } = await client.auth.getUser();
      const definitelyInvalid = !userData.user && (!error || error.status === 401 || error.status === 403);
      if (definitelyInvalid) await client.auth.signOut({ scope: "local" });
    })().finally(() => { validationInFlight = null; });
    return validationInFlight;
  };

  void validateStoredSession();
  window.addEventListener("focus", () => { void validateStoredSession(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void validateStoredSession();
  });
}
