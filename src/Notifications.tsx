import { useEffect, useRef, useState } from "react";
import { Bell, Users, DoorOpen, UserPlus, BarChart3, CalendarPlus } from "lucide-react";
import { supabase } from "./supabaseClient";
import {
  fetchNotifications, markAllNotificationsRead, getPublicProfiles, fetchRooms,
  type AppNotification, type PublicProfile,
} from "./rooms";
import { displayNameOf } from "./Friends";
import type { Session } from "@supabase/supabase-js";

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const KIND_ICON = {
  friend_request: UserPlus,
  friend_accepted: Users,
  room_invite: DoorOpen,
  room_created: DoorOpen,
  room_joined: Users,
  stats_request: BarChart3,
  stats_approved: BarChart3,
  planned_study_invite: CalendarPlus,
} as const;

function label(n: AppNotification, actor: PublicProfile | undefined, room: { name: string; mine: boolean } | undefined): string {
  const who = displayNameOf(actor);
  // room_id goes null when the room has since ended (rooms are reaped once
  // empty) — the notification survives with an honest fallback.
  const roomText = room ? `“${room.name}”` : n.room_id ? "a study room" : "a study room (it has since ended)";
  switch (n.kind) {
    case "friend_request": return `${who} sent you a friend request`;
    case "friend_accepted": return `${who} accepted your friend request`;
    case "room_invite": return `${who} invited you to ${roomText}`;
    case "room_created": return `${who} started ${roomText}`;
    case "room_joined": return room?.mine ? `${who} joined your room ${roomText}` : `${who} joined ${roomText}`;
    case "stats_request": return `${who} requested permission to compare study statistics`;
    case "stats_approved": return `${who} approved your study statistics request`;
    case "planned_study_invite": return `${who} invited you to a planned study event`;
  }
}

export function NotificationsBell({ session, onOpenRoom, onOpenFriends, onOpenPlannedStudy }: {
  session: Session;
  onOpenRoom: (roomId: string) => void;
  onOpenFriends: () => void;
  onOpenPlannedStudy: () => void;
}) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [actors, setActors] = useState<Map<string, PublicProfile>>(new Map());
  const [roomInfo, setRoomInfo] = useState<Map<string, { name: string; mine: boolean }>>(new Map());
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const userId = session.user.id;
  const unread = items.filter((n) => !n.read).length;

  // Initial load + live inserts for this user.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const rows = await fetchNotifications();
      if (cancelled) return;
      setItems(rows);
      const actorIds = [...new Set(rows.map((n) => n.actor_id).filter(Boolean))] as string[];
      setActors(await getPublicProfiles(actorIds));
      const rooms = await fetchRooms();
      if (!cancelled) setRoomInfo(new Map(rooms.map((r) => [r.id, { name: r.name, mine: r.host_id === userId }])));
    };
    load();

    if (!supabase) return () => { cancelled = true; };
    const client = supabase;
    const channel = client
      .channel(`notifs-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        async (payload) => {
          const n = payload.new as AppNotification;
          setItems((prev) => [n, ...prev].slice(0, 30));
          if (n.actor_id) {
            const fresh = await getPublicProfiles([n.actor_id]);
            setActors((prev) => new Map([...prev, ...fresh]));
          }
        })
      .subscribe();
    return () => { cancelled = true; client.removeChannel(channel); };
  }, [userId]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      markAllNotificationsRead(userId);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  };

  const activate = (n: AppNotification) => {
    setOpen(false);
    if (n.room_id) onOpenRoom(n.room_id);
    else if (n.kind === "planned_study_invite") onOpenPlannedStudy();
    else onOpenFriends();
  };

  return (
    <div className="relative" ref={panelRef}>
      <button onClick={toggle} aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-border bg-card p-2 shadow-xl">
          <p className="px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Notifications</p>
          {items.length === 0 && <p className="px-2.5 pb-2 text-sm text-muted-foreground">Nothing yet. Add friends and they'll show up here.</p>}
          <div className="max-h-80 overflow-y-auto">
            {items.map((n) => {
              const Icon = KIND_ICON[n.kind];
              const room = n.room_id ? roomInfo.get(n.room_id) : undefined;
              return (
                <button key={n.id} onClick={() => activate(n)}
                  className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-primary/5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Icon size={13} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug">{label(n, n.actor_id ? actors.get(n.actor_id) : undefined, room)}</span>
                    <span className="block text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</span>
                    {n.kind === "room_invite" && n.room_id && room && (
                      <span className="mt-1 inline-block rounded-full gradient-primary px-3 py-1 text-[11px] font-semibold text-white shadow-glow">
                        Accept & join
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
