// Stand-in for src/supabaseClient.ts, used ONLY by the promo's focus harness.
// Lets the production App render offline as a signed-in sample account
// (Premium, with pets, plants, exams and tasks), because sign-in on production
// is protected by Cloudflare Turnstile. Every screen is the unchanged app; only
// the data layer is replaced by this small in-memory table store.
import { PET_CATALOG, REWARD_CATALOG } from "../../src/petCatalog";

const now = new Date();
const iso = (d: Date) => d.toISOString();
const dayKey = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const ME = "me";

const ACTIVE_PETS = new Set(["dog", "cat"]);
const ACTIVE_REWARDS = new Set(["sunflower", "fern", "bonsai", "tulip", "succulent", "study_cap", "ball", "pet_bed", "snack_bowl"]);
const LEVEL = 40;

type Row = Record<string, unknown>;
const DB: Record<string, Row[]> = {
  profiles: [{
    id: ME, email: "student@example.com", username: "alex", display_name: "Alex", avatar_path: null,
    is_premium: true, stripe_customer_id: null, stripe_subscription_id: null, daily_goal_minutes: 120,
    exam_date: null, exam_name: null, ai_uploads_count: 0, ai_uploads_period: null, ai_credits: 0,
    theme: (window as unknown as { __theme?: string }).__theme ?? "coffee", onboarded: true, tutorial_seen: true,
  }],
  exam_schedules: ((window as unknown as { __exams?: { name: string; offset: number }[] }).__exams ?? [
    { name: "Cardiology EOR", offset: 12 },
  ]).map((e, i) => ({ id: `ex${i}`, user_id: ME, name: e.name, exam_date: dayKey(e.offset), created_at: iso(now), updated_at: iso(now) })),
  tasks: [
    { id: "t1", user_id: ME, title: "Heart failure: HFrEF vs HFpEF", tag: "Cardiology", done: false, poms: 1, est: 2, sort_order: 1, created_at: iso(now) },
    { id: "t2", user_id: ME, title: "Pharm flashcards: antiarrhythmics", tag: "Pharmacology", done: false, poms: 0, est: 2, sort_order: 2, created_at: iso(now) },
    { id: "t3", user_id: ME, title: "Renal: acid–base practice set", tag: "Renal", done: false, poms: 0, est: 1, sort_order: 3, created_at: iso(now) },
  ],
  study_session_events: [-4, -3, -2, -1].map((o, i) => ({ id: `se${i}`, user_id: ME, minutes: 50 + i * 10, session_date: dayKey(o), created_at: dayKey(o) + "T15:00:00Z", task_id: null, session_kind: "pomodoro" })),
  planned_study_sessions: [], planned_study_invites: [], notifications: [], friendships: [], rooms: [],
  room_messages: [], room_heartbeats: [], user_pets: [], user_rewards: [], music_tracks: [], app_events: [], client_errors: [],
  stat_comparison_permissions: [],
};

function gamification() {
  return {
    xp: 80000, level: LEVEL, sessions_completed: 140, xp_for_level: (LEVEL - 1) ** 2 * 50, xp_for_next: LEVEL ** 2 * 50, stats_public: false,
    achievements: [],
    pets: PET_CATALOG.map((p) => ({ ...p, owned: p.unlock_sessions <= 140, is_active: ACTIVE_PETS.has(p.id), earned_at: null })),
    rewards: REWARD_CATALOG.map((r) => ({
      ...r, owned: r.unlock_level <= LEVEL, is_active: ACTIVE_REWARDS.has(r.id),
      growth_points: 40, growth_minutes: r.id === "bonsai" ? 900 : r.id === "sunflower" ? 600 : 400, earned_at: null,
    })),
  };
}

let uid = 0;
const result = (data: unknown) => Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : null });
function builder(table: string) {
  const rows = (DB[table] ??= []);
  let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  let payload: Row | Row[] | null = null;
  const filters: ((r: Row) => boolean)[] = [];
  let single = false;
  let touched: Row[] = [];
  const run = () => {
    const match = (r: Row) => filters.every((f) => f(r));
    if (op === "insert" || op === "upsert") {
      const list = (Array.isArray(payload) ? payload : [payload!]).map((p) => ({ id: `n${++uid}`, created_at: iso(new Date()), updated_at: iso(new Date()), ...p }));
      rows.push(...list); touched = list;
    } else if (op === "update") {
      touched = rows.filter(match); touched.forEach((r) => Object.assign(r, payload));
    } else if (op === "delete") {
      touched = rows.filter(match); touched.forEach((r) => rows.splice(rows.indexOf(r), 1));
    } else touched = rows.filter(match);
    return single ? (touched[0] ?? null) : touched;
  };
  const self: Record<string, unknown> = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => result(run()).then(res, rej);
      if (prop === "insert" || prop === "upsert" || prop === "update") return (p: Row | Row[]) => { op = prop; payload = p; return self; };
      if (prop === "delete") return () => { op = "delete"; return self; };
      if (prop === "eq") return (k: string, v: unknown) => { filters.push((r) => r[k] === v); return self; };
      if (prop === "in") return (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return self; };
      if (prop === "single" || prop === "maybeSingle") return () => { single = true; return self; };
      return () => self;
    },
  });
  return self;
}

function channel() {
  const ch = {
    on() { return ch; },
    subscribe(cb?: (s: string) => void) { setTimeout(() => cb?.("SUBSCRIBED"), 0); return ch; },
    presenceState() { return {}; },
    track: () => Promise.resolve("ok"), untrack: () => Promise.resolve("ok"), send: () => Promise.resolve("ok"),
    unsubscribe: () => Promise.resolve("ok"),
  };
  return ch;
}

const session = { access_token: "harness", user: { id: ME, email: "student@example.com", user_metadata: {}, created_at: dayKey(-60) } };
export const supabase = {
  from: builder,
  rpc(fn: string) {
    if (fn === "get_my_gamification") return result(gamification());
    if (fn === "sync_my_gamification") return result({ xp: 80000, level: LEVEL, sessions_completed: 140, new_achievements: [], new_pets: [], new_rewards: [] });
    if (fn === "get_my_premium_entitlement") return result([{ is_premium: true, source: "stripe", expires_at: null, cancel_at_period_end: false }]);
    if (fn === "is_admin") return result(false);
    if (fn === "room_occupancy") return result([]);
    return result(null);
  },
  channel, removeChannel: () => Promise.resolve("ok"), removeAllChannels: () => Promise.resolve("ok"),
  realtime: { setAuth: () => {} },
  auth: {
    getSession: () => result({ session }), getUser: () => result({ user: session.user }),
    onAuthStateChange: (cb: (e: string, s: unknown) => void) => { setTimeout(() => cb("INITIAL_SESSION", session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
    signOut: () => result(null), refreshSession: () => result({ session }),
  },
  storage: { from: () => ({ upload: () => result(null), remove: () => result(null), createSignedUrl: () => result(null) }) },
  functions: { invoke: () => result(null) },
};
export const supabaseEnabled = true;
export const arrivedViaEmailLink = false;
