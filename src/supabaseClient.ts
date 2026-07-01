import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseEnabled = Boolean(url && anonKey);

if (!supabaseEnabled) {
  console.warn(
    "[Roamly] Supabase env vars are missing — accounts, sync, and payments are disabled. " +
    "The app runs in local-only demo mode until VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set."
  );
}

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url as string, anonKey as string)
  : null;
