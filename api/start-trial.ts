import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return Response.json({ error: "Trial service is unavailable." }, { status: 503 });

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return Response.json({ error: "Missing auth token" }, { status: 401 });

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return Response.json({ error: "Invalid session" }, { status: 401 });
  if (!data.user.email_confirmed_at) return Response.json({ error: "Verify your email before starting Premium." }, { status: 403 });

  const { data: expiresAt, error: trialError } = await admin.rpc("start_trial_if_eligible", { p_user: data.user.id });
  if (trialError) return Response.json({ error: "Trial is not available yet." }, { status: 500 });
  return Response.json({ expires_at: expiresAt });
}
