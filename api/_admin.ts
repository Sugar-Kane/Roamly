import { createClient } from "@supabase/supabase-js";

// Admin gate for server routes: ask public.is_admin() AS THE CALLER (their own
// JWT, publishable key), so the database is the single authority. It checks
// membership of public.admins and that the session completed two-step
// verification (aal2) — reading the admins table with the service role here
// would skip that second check.
export async function callerIsAdmin(supabaseUrl: string, publishableKey: string, token: string): Promise<boolean> {
  const asCaller = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await asCaller.rpc("is_admin");
  return !error && data === true;
}
