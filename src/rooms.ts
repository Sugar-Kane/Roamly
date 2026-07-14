import { supabase } from "./supabaseClient";
import type { Phase } from "./useTimer";
import type { PlannedStudyInvite } from "./release3";

export type LiveRoom = {
  id: string;
  name: string;
  topic: string;
  host_id: string | null;
  is_system: boolean;
  focus_min: number;
  short_min: number;
  long_min: number;
  cycles: number;
  cap: number;
  music: string; // FocusSoundId of the room's shared track; always-on rooms are 'lofi'
  visibility: "public" | "private";
  invite_code: string | null;
  started_at: string;
  created_at: string;
};

export type RoomPhaseInfo = {
  phase: Phase;
  secondsLeft: number;
  phaseTotal: number; // length of the current phase, in seconds
  focusIndex: number; // 1-based focus block within the cycle
};

// A room's timer never ticks on any server. The phase is pure arithmetic on
// wall-clock time since started_at — (focus, short) × (cycles-1), focus, long,
// repeating forever — so every participant derives the identical countdown
// and the system rooms run continuously. Mirrors room_phase() in
// supabase/rooms_schema.sql, which enforces break-only chat server-side.
// ---- Server clock sync ----
// Room phases are wall-clock math, so a device with a skewed clock sees a
// different countdown than everyone else — and can even have its break-time
// chat rejected by the database's timing trigger while its own UI says the
// break is open. Estimate the server-client offset once from HTTP Date
// response headers (lowest-round-trip sample wins) and fold it into every
// room-time calculation. Offsets under 1.5s are ignored: the Date header
// only has second resolution, so tiny corrections would be noise.
let clockOffsetMs = 0;
let clockSyncStarted = false;

export function roomNowMs(): number {
  return Date.now() + clockOffsetMs;
}

export async function syncServerClock(): Promise<void> {
  if (clockSyncStarted || !supabase) return;
  clockSyncStarted = true;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!base || !anonKey) return;
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < 3; i++) {
    try {
      const t0 = Date.now();
      const res = await fetch(`${base}/rest/v1/`, { headers: { apikey: anonKey }, cache: "no-store" });
      const t1 = Date.now();
      const dateHeader = res.headers.get("date");
      if (!dateHeader) return;
      const serverMs = new Date(dateHeader).getTime() + 500; // header truncates to the second; use the midpoint
      const offset = serverMs - (t0 + t1) / 2;
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, offset };
    } catch {
      break; // offline — keep the local clock
    }
  }
  if (best && Math.abs(best.offset) > 1500) clockOffsetMs = best.offset;
}

export function roomPhaseAt(room: LiveRoom, atMs: number = roomNowMs()): RoomPhaseInfo {
  const f = room.focus_min * 60;
  const s = room.short_min * 60;
  const l = room.long_min * 60;
  const c = room.cycles;
  const total = c * f + (c - 1) * s + l;
  let e = Math.floor((atMs - new Date(room.started_at).getTime()) / 1000) % total;
  if (e < 0) e += total;
  for (let i = 1; i <= c; i++) {
    if (e < f) return { phase: "focus", secondsLeft: f - e, phaseTotal: f, focusIndex: i };
    e -= f;
    if (i < c) {
      if (e < s) return { phase: "short", secondsLeft: s - e, phaseTotal: s, focusIndex: i };
      e -= s;
    }
  }
  return { phase: "long", secondsLeft: l - e, phaseTotal: l, focusIndex: c };
}

export type PublicProfile = { id: string; username: string | null; display_name: string | null; stats_public?: boolean };

export type Friendship = {
  id: string;
  requester: string;
  addressee: string;
  status: "pending" | "accepted";
  created_at: string;
};

export type RoomMessage = {
  id: string;
  room_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export type AppNotification = {
  id: string;
  user_id: string;
  actor_id: string | null;
  kind: "friend_request" | "friend_accepted" | "room_invite" | "room_created" | "room_joined" | "stats_request" | "stats_approved" | "planned_study_invite";
  room_id: string | null;
  planned_study_session_id: string | null;
  read: boolean;
  created_at: string;
};

// Hosted rooms older than this are treated as ended and hidden from the lobby.
const HOSTED_ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export async function fetchRooms(): Promise<LiveRoom[]> {
  if (!supabase) return [];
  // Best-effort global sweep before listing — the fallback path when pg_cron
  // isn't running the sweep server-side. No-ops if the migration isn't applied.
  await supabase.rpc("reap_stale_rooms").then(({ error }) => {
    if (error && !error.message.includes("find the function") && !error.message.includes("does not exist")) {
      console.warn("[Roamly] reap_stale_rooms failed", error.message);
    }
  });
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .order("is_system", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) { console.warn("[Roamly] fetchRooms failed", error.message); return []; }
  const cutoff = Date.now() - HOSTED_ROOM_TTL_MS;
  return ((data ?? []) as LiveRoom[]).filter(
    (r) => r.is_system || new Date(r.created_at).getTime() > cutoff
  );
}

export async function createRoom(
  hostId: string,
  fields: { name: string; topic: string; focus_min: number; short_min: number; long_min: number; cycles: number; cap: number; music: string; visibility: "public" | "private" }
): Promise<LiveRoom | null> {
  if (!supabase) return null;
  const client = supabase;
  const { data, error } = await client
    .from("rooms")
    .insert({ host_id: hostId, ...fields })
    .select("*")
    .single();
  if (!error) return data as LiveRoom;
  // Before the room-music migration is applied, the `music` column doesn't
  // exist yet — retry without it so hosting still works (room defaults to lofi).
  if (error.message.includes("music")) {
    const { music: _music, ...rest } = fields;
    void _music;
    const retry = await client.from("rooms").insert({ host_id: hostId, ...rest }).select("*").single();
    if (!retry.error) return { ...(retry.data as LiveRoom), music: "lofi" };
    console.warn("[Roamly] createRoom failed", retry.error.message);
    return null;
  }
  console.warn("[Roamly] createRoom failed", error.message);
  return null;
}

export async function joinRoom(roomId: string, code?: string): Promise<{ room?: LiveRoom; error?: string }> {
  if (!supabase) return { error: "Rooms aren't available right now." };
  const { data, error } = await supabase.rpc("join_room", { p_room: roomId, p_code: code?.trim() || null });
  if (!error && data?.[0]) return { room: data[0] as LiveRoom };
  if (error?.message.includes("room_access_denied")) return { error: "This private room requires an invitation or valid code." };
  if (error?.message.includes("room_not_found")) return { error: "That room is no longer available." };
  return { error: "Couldn't join that room. Try again." };
}

export async function joinRoomByCode(code: string): Promise<{ room?: LiveRoom; error?: string }> {
  if (!supabase) return { error: "Rooms aren't available right now." };
  const { data, error } = await supabase.rpc("join_room_by_code", { p_code: code.trim().toUpperCase() });
  if (!error && data?.[0]) return { room: data[0] as LiveRoom };
  if (error?.message.includes("invalid_invite_code")) return { error: "That invite code isn't valid." };
  return { error: "Couldn't join that room. Try again." };
}

export async function deleteRoom(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from("rooms").delete().eq("id", id);
  if (error) console.warn("[Roamly] deleteRoom failed", error.message);
}

// Change a hosted room's shared music track. RLS (rooms_update_host) only lets
// the room's own host do this. No-ops quietly if the migration isn't applied.
export async function setRoomMusic(id: string, music: string) {
  if (!supabase) return;
  const { error } = await supabase.from("rooms").update({ music }).eq("id", id);
  if (error && !error.message.includes("music")) {
    console.warn("[Roamly] setRoomMusic failed", error.message);
  }
}

// Auto-cleanup for a hosted room the caller has observed empty. reap_room is
// SECURITY DEFINER (so any signed-in lobby viewer can trigger it, not just the
// host) and only deletes non-system rooms older than 2 minutes — the age guard
// keeps it from ever removing a freshly created room. No-ops silently if the
// function/migration isn't present yet.
export async function reapRoom(id: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc("reap_room", { p_room: id });
  if (error && !error.message.includes("find the function") && !error.message.includes("does not exist")) {
    console.warn("[Roamly] reapRoom failed", error.message);
  }
}

export async function fetchMessages(roomId: string, limit = 50): Promise<RoomMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("room_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.warn("[Roamly] fetchMessages failed", error.message); return []; }
  return ((data ?? []) as RoomMessage[]).reverse();
}

// Returns an error string for the UI (null on success) — the DB trigger
// rejects messages sent during a focus block even if the UI gate is bypassed.
export async function sendMessage(roomId: string, userId: string, body: string): Promise<string | null> {
  if (!supabase) return "Chat isn't available right now.";
  const { error } = await supabase.from("room_messages").insert({ room_id: roomId, user_id: userId, body });
  if (!error) return null;
  if (error.message.includes("chat_closed_during_focus")) return "Chat is closed during focus. It opens at the break.";
  if (error.message.includes("chat_rate_limited")) return "Whoa, slow down a little. You can send more messages in a minute.";
  console.warn("[Roamly] sendMessage failed", error.message);
  return "Couldn't send that message. Try again.";
}

// Room heartbeats: while someone is in a room they upsert a ping every
// minute; reap_room() refuses to delete a room with a heartbeat fresher than
// 2 minutes, so an occupied room can never be reaped out from under people.
// Both no-op quietly if the migration hasn't been applied yet.
export async function heartbeatRoom(roomId: string, userId: string) {
  if (!supabase) return;
  const { error } = await supabase
    .from("room_heartbeats")
    .upsert({ room_id: roomId, user_id: userId, seen_at: new Date().toISOString() });
  if (error && !error.message.includes("does not exist")) {
    console.warn("[Roamly] heartbeat failed", error.message);
  }
}

export async function clearRoomHeartbeat(roomId: string, userId: string) {
  if (!supabase) return;
  await supabase.from("room_heartbeats").delete().eq("room_id", roomId).eq("user_id", userId);
}

export async function fetchFriendships(): Promise<Friendship[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("friendships").select("*").order("created_at", { ascending: false });
  if (error) { console.warn("[Roamly] fetchFriendships failed", error.message); return []; }
  return (data ?? []) as Friendship[];
}

export async function searchUsers(query: string): Promise<PublicProfile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("search_users", { p_query: query });
  if (error) { console.warn("[Roamly] searchUsers failed", error.message); return []; }
  return (data ?? []) as PublicProfile[];
}

// Exact-email lookup (find_user_by_email is SECURITY DEFINER: signed-in
// callers, full address required, returns public fields only — never emails).
export async function findUserByEmail(email: string): Promise<PublicProfile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("find_user_by_email", { p_email: email });
  if (error) { console.warn("[Roamly] findUserByEmail failed", error.message); return null; }
  return ((data ?? [])[0] as PublicProfile) ?? null;
}

export async function sendFriendRequest(targetId: string): Promise<string | null> {
  if (!supabase) return "Friends aren't available right now.";
  const { error } = await supabase.rpc("send_friend_request", { p_target: targetId });
  if (!error) return null;
  if (error.message.includes("already_exists")) return "You already have a request or friendship with them.";
  console.warn("[Roamly] sendFriendRequest failed", error.message);
  return "Couldn't send that request. Try again.";
}

export async function respondFriendRequest(id: string, accept: boolean) {
  if (!supabase) return;
  const { error } = await supabase.rpc("respond_friend_request", { p_id: id, p_accept: accept });
  if (error) console.warn("[Roamly] respondFriendRequest failed", error.message);
}

export async function removeFriendship(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from("friendships").delete().eq("id", id);
  if (error) console.warn("[Roamly] removeFriendship failed", error.message);
}

export async function fetchNotifications(limit = 30): Promise<AppNotification[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.warn("[Roamly] fetchNotifications failed", error.message); return []; }
  return (data ?? []) as AppNotification[];
}

export async function markAllNotificationsRead(userId: string) {
  if (!supabase) return;
  const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
  if (error) console.warn("[Roamly] markAllNotificationsRead failed", error.message);
}

export async function notifyFriendsOfRoom(roomId: string, kind: "room_created" | "room_joined") {
  if (!supabase) return;
  const { error } = await supabase.rpc("notify_friends_of_room", { p_room: roomId, p_kind: kind });
  if (error) console.warn("[Roamly] notifyFriendsOfRoom failed", error.message);
}

export async function inviteToRoom(roomId: string, userId: string): Promise<string | null> {
  if (!supabase) return "Invites aren't available right now.";
  const { error } = await supabase.rpc("invite_to_room", { p_room: roomId, p_user: userId });
  if (!error) return null;
  if (error.message.includes("not_friends")) return "You can only invite accepted friends.";
  console.warn("[Roamly] inviteToRoom failed", error.message);
  return "Couldn't send that invite. Try again.";
}

export async function inviteFriendsToPlannedStudy(planId: string, inviterId: string, friendIds: string[]): Promise<string | null> {
  if (!supabase || friendIds.length === 0) return null;
  const rows = [...new Set(friendIds)].map((inviteeId) => ({
    plan_id: planId,
    inviter_id: inviterId,
    invitee_id: inviteeId,
  }));
  const { error } = await supabase.from("planned_study_invites").insert(rows);
  if (!error) return null;
  console.warn("[Roamly] inviteFriendsToPlannedStudy failed", error.message);
  return error.message.includes("duplicate")
    ? "One or more friends were already invited."
    : "The plan was saved, but some invitations could not be sent.";
}

export async function fetchIncomingPlannedStudyInvites(userId: string): Promise<PlannedStudyInvite[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("planned_study_invites")
    .select("id, plan_id, inviter_id, invitee_id, status, created_at, updated_at, plan:planned_study_sessions(*)")
    .eq("invitee_id", userId)
    .neq("status", "declined")
    .order("created_at", { ascending: false });
  if (error) { console.warn("[Roamly] fetchIncomingPlannedStudyInvites failed", error.message); return []; }
  return (data ?? []) as unknown as PlannedStudyInvite[];
}

export async function respondPlannedStudyInvite(id: string, status: "accepted" | "declined"): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("planned_study_invites")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) { console.warn("[Roamly] respondPlannedStudyInvite failed", error.message); return false; }
  return true;
}

export async function setUsername(username: string): Promise<string | null> {
  if (!supabase) return "Accounts aren't available right now.";
  const { error } = await supabase.rpc("set_username", { p_username: username });
  if (!error) return null;
  if (error.message.includes("invalid_username")) return "3-20 characters: lowercase letters, numbers, underscores.";
  if (error.message.includes("duplicate") || error.message.includes("unique")) return "That username is taken.";
  console.warn("[Roamly] setUsername failed", error.message);
  return "Couldn't save that username. Try again.";
}

export async function getPublicProfiles(ids: string[]): Promise<Map<string, PublicProfile>> {
  const map = new Map<string, PublicProfile>();
  if (!supabase || ids.length === 0) return map;
  const { data, error } = await supabase.rpc("get_public_profiles", { p_ids: ids });
  if (error) { console.warn("[Roamly] getPublicProfiles failed", error.message); return map; }
  for (const p of (data ?? []) as PublicProfile[]) map.set(p.id, p);
  return map;
}

export type StatPermission = { owner_id: string; viewer_id: string; status: "pending" | "approved"; requested_by: string; created_at: string; updated_at: string };
export type FriendComparison = { focus_minutes: number; session_count: number; weekly_consistency: number; achievements: number; level: number; category_minutes: Record<string, number>; pets_count: number };

export async function fetchStatPermissions(): Promise<StatPermission[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("stat_comparison_permissions").select("*").order("updated_at", { ascending: false });
  if (error) { console.warn("[Roamly] fetchStatPermissions failed", error.message); return []; }
  return (data ?? []) as StatPermission[];
}
export async function requestStatComparison(friendId: string): Promise<string | null> {
  if (!supabase) return "Statistics aren't available right now.";
  const { error } = await supabase.rpc("request_stat_comparison", { p_friend: friendId });
  return error ? "Couldn't request statistics sharing." : null;
}
export async function respondStatComparison(viewerId: string, approve: boolean): Promise<string | null> {
  if (!supabase) return "Statistics aren't available right now.";
  const { error } = await supabase.rpc("respond_stat_comparison", { p_viewer: viewerId, p_approve: approve });
  return error ? "Couldn't update that request." : null;
}
export async function revokeStatComparison(friendId: string): Promise<void> {
  if (supabase) await supabase.rpc("revoke_stat_comparison", { p_friend: friendId });
}
export async function getFriendComparison(friendId: string): Promise<FriendComparison | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_friend_comparison", { p_friend: friendId });
  if (error || !data?.[0]) return null;
  return data[0] as FriendComparison;
}
