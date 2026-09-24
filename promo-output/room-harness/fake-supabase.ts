// Stand-in for src/supabaseClient.ts, used ONLY by the promo's room harness.
// It lets the production RoomsLive component render offline with sample data:
// the four real always-on rooms (as seeded in production) and fictional members.
const ROOMS = [
  { id: "00000000-0000-4000-a000-000000000001", name: "The Grind Hall", topic: "Classic 25/5 Pomodoro", focus_min: 25, short_min: 5, long_min: 15, cycles: 4, started_at: "2026-07-02T22:08:59.768Z" },
  { id: "00000000-0000-4000-a000-000000000002", name: "Deep Work Hall", topic: "Long 50/10 blocks for dense material", focus_min: 50, short_min: 10, long_min: 20, cycles: 3, started_at: "2026-07-02T21:50:59.768Z" },
  { id: "00000000-0000-4000-a000-000000000003", name: "Sprint Studio", topic: "Quick 15/3 bursts for flashcards", focus_min: 15, short_min: 3, long_min: 10, cycles: 5, started_at: "2026-07-02T22:01:59.768Z" },
  { id: "00000000-0000-4000-a000-000000000004", name: "Marathon Library", topic: "Endurance 90/20 — library rules", focus_min: 90, short_min: 20, long_min: 30, cycles: 2, started_at: "2026-07-02T21:23:59.768Z" },
].map((r) => ({ ...r, host_id: null, is_system: true, cap: 50, music: "lofi", visibility: "public", invite_code: null, created_at: r.started_at }));

const W = window as unknown as { __members?: string[]; __messages?: { user_id: string; body: string; created_at: string }[] };
const members = () => W.__members ?? ["alex"];
const OCC: Record<string, number> = { [ROOMS[0].id]: 14, [ROOMS[1].id]: 9, [ROOMS[2].id]: 6, [ROOMS[3].id]: 3 };

const result = (data: unknown) => Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : null });
function builder(table: string) {
  let single = false;
  const rows = () => {
    if (table === "rooms") return ROOMS;
    if (table === "room_messages") return (W.__messages ?? []).map((m, i) => ({ id: `m${i}`, room_id: ROOMS[1].id, ...m }));
    if (table === "profiles") return members().map((u, i) => ({ id: i === 0 ? "me" : `u${i}`, username: u, display_name: null }));
    return [];
  };
  const b: Record<string, unknown> = {};
  const self = new Proxy(b, {
    get(_t, prop) {
      if (prop === "then") { const d = rows(); return (res: (v: unknown) => void, rej: (e: unknown) => void) => result(single ? (d[0] ?? null) : d).then(res, rej); }
      if (prop === "single" || prop === "maybeSingle") return () => { single = true; return self; };
      return () => self;
    },
  });
  return self;
}

function channel(name: string) {
  const handlers: { type: string; ev?: string; cb: (p?: unknown) => void }[] = [];
  const ch = {
    on(type: string, filter: { event?: string }, cb: (p?: unknown) => void) { handlers.push({ type, ev: filter?.event, cb }); return ch; },
    subscribe(cb?: (s: string) => void) {
      setTimeout(() => { cb?.("SUBSCRIBED"); handlers.filter((h) => h.type === "presence" && h.ev === "sync").forEach((h) => h.cb()); }, 0);
      return ch;
    },
    presenceState() {
      if (!name.startsWith("room:")) return {};
      const st: Record<string, { username: string }[]> = {};
      members().forEach((u, i) => { st[i === 0 ? "me" : `u${i}`] = [{ username: u }]; });
      return st;
    },
    track: () => Promise.resolve("ok"), untrack: () => Promise.resolve("ok"), send: () => Promise.resolve("ok"),
    unsubscribe: () => Promise.resolve("ok"),
  };
  return ch;
}

const session = { access_token: "harness", user: { id: "me", email: "student@example.com", user_metadata: {} } };
export const supabase = {
  from: builder,
  rpc(fn: string) {
    if (fn === "room_occupancy") return result(ROOMS.map((r) => ({ room_id: r.id, occupants: OCC[r.id] })));
    if (fn === "join_room") return result([ROOMS[1]]);
    if (fn === "get_public_profiles") return result(members().map((u, i) => ({ id: i === 0 ? "me" : `u${i}`, username: u, display_name: null })));
    return result(null);
  },
  channel, removeChannel: () => Promise.resolve("ok"),
  realtime: { setAuth: () => {} },
  auth: {
    getSession: () => result({ session }), getUser: () => result({ user: session.user }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: () => result(null),
  },
  storage: { from: () => ({ upload: () => result(null), remove: () => result(null), createSignedUrl: () => result(null) }) },
  functions: { invoke: () => result(null) },
};
export const supabaseEnabled = true;
export const arrivedViaEmailLink = false;
export const HARNESS_SESSION = session;
