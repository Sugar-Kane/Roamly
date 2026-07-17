// Profile menu, anchored to the avatar in the top-right of the header. A quick
// launcher: the identity summary, a jump into the full Account settings panel
// (where display name, username, photo, privacy, data export, and account
// deletion live), and fast links (plan, friends, admin, settings, feedback).
// The app preferences (accessibility, app tour) live in the Settings modal,
// and deeper account management in AccountSettings, so this stays a small,
// one-glance menu.

import { useEffect, useRef, useState } from "react";
import { Crown, LogIn, LogOut, ChevronRight, Users, Shield, MessageSquare, SlidersHorizontal } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { loadPref } from "./storage";
import type { Profile } from "./db";
import { currentUploadPeriod, FREE_MONTHLY_UPLOAD_QUOTA, PREMIUM_MONTHLY_UPLOAD_QUOTA } from "./UploadTasks";

export type A11ySettings = {
  colorBlind: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  largeText: boolean;
};

export const DEFAULT_A11Y: A11ySettings = {
  colorBlind: false,
  highContrast: false,
  reduceMotion: false,
  largeText: false,
};

export function loadA11y(): A11ySettings {
  try {
    return { ...DEFAULT_A11Y, ...JSON.parse(loadPref("roamly-a11y") ?? "{}") };
  } catch {
    return DEFAULT_A11Y;
  }
}

function ProfileAvatar({ url, initials, className }: { url?: string | null; initials: string; className: string }) {
  return <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full gradient-primary font-semibold text-white ${className}`}>
    {initials}
    {url && <img key={url} src={url} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />}
  </span>;
}

export function ProfileMenu({ session, profile, isPremium, onSignIn, onSignOut, onOpenAccount, onOpenPremium, onOpenFriends, isAdmin, onOpenAdmin, onOpenSettings, onSendFeedback }: {
  session: Session | null;
  profile: Profile | null;
  isPremium: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenAccount: () => void;
  onOpenPremium: () => void;
  onOpenFriends: () => void;
  isAdmin: boolean;
  onOpenAdmin: () => void;
  onOpenSettings: () => void;
  onSendFeedback: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside tap/click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = profile?.display_name || profile?.username || null;
  const email = session?.user.email ?? null;
  const initials = (name ?? email ?? "?").slice(0, 2).toUpperCase();

  // AI upload balance for the plan row: the monthly allowance resets each
  // month (never rolls over); purchased credits persist until used.
  const usedThisPeriod = profile?.ai_uploads_period === currentUploadPeriod() ? (profile?.ai_uploads_count ?? 0) : 0;
  const uploadQuota = isPremium ? PREMIUM_MONTHLY_UPLOAD_QUOTA : FREE_MONTHLY_UPLOAD_QUOTA;
  const uploadsRemaining = Math.max(0, uploadQuota - usedThisPeriod);
  const credits = profile?.ai_credits ?? 0;

  return (
    <div ref={rootRef} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Open profile menu" aria-expanded={open}
        className="rounded-full shadow-glow transition active:scale-95">
        <ProfileAvatar url={session ? profile?.avatar_url : null} initials={session ? initials : "☺"} className="h-9 w-9 text-sm" />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-2xl border border-border bg-card p-2 shadow-xl">
          {/* Account summary — tap to open full account settings when signed in */}
          {session ? (
            <button onClick={() => { setOpen(false); onOpenAccount(); }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-secondary/60">
              <ProfileAvatar url={profile?.avatar_url} initials={initials} className="h-10 w-10 text-sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm font-semibold">{name ?? "Set up your profile"}</span>
                  {isPremium && <Crown size={13} className="shrink-0 text-primary" aria-label="Premium member" />}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{email}</span>
              </span>
              <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
              <ProfileAvatar url={null} initials="☺" className="h-10 w-10 text-sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">Not signed in</span>
                <span className="block truncate text-xs text-muted-foreground">Sign in to sync your data</span>
              </span>
            </div>
          )}

          {/* Plan */}
          {session && (
            <button onClick={() => { setOpen(false); onOpenPremium(); }}
              className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card/70 px-3 py-2.5 text-left transition hover:border-primary/40">
              <span className="flex min-w-0 items-center gap-2">
                <Crown size={15} className="shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{isPremium ? "Premium plan" : "Free plan"}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {isPremium ? "All Premium features unlocked" : "Music is free. Upgrade for hosting and more"}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    AI uploads: {uploadsRemaining} of {uploadQuota} left this month · {credits} purchased credit{credits === 1 ? "" : "s"}
                  </span>
                </span>
              </span>
              <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
            </button>
          )}

          {/* Friends */}
          {session && (
            <button onClick={() => { setOpen(false); onOpenFriends(); }}
              className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card/70 px-3 py-2.5 text-left transition hover:border-primary/40">
              <span className="flex min-w-0 items-center gap-2">
                <Users size={15} className="shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Friends</span>
                  <span className="block truncate text-[11px] text-muted-foreground">Add classmates by username or email</span>
                </span>
              </span>
              <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
            </button>
          )}

          {/* Admin (only for admins) */}
          {session && isAdmin && (
            <button onClick={() => { setOpen(false); onOpenAdmin(); }}
              className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card/70 px-3 py-2.5 text-left transition hover:border-primary/40">
              <span className="flex min-w-0 items-center gap-2">
                <Shield size={15} className="shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Admin</span>
                  <span className="block truncate text-[11px] text-muted-foreground">Grant or remove Premium</span>
                </span>
              </span>
              <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
            </button>
          )}

          {/* Settings — app preferences (confetti, accessibility, app tour).
              Works signed-out: the prefs are stored on this device. */}
          <button onClick={() => { setOpen(false); onOpenSettings(); }}
            className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card/70 px-3 py-2.5 text-left transition hover:border-primary/40">
            <span className="flex min-w-0 items-center gap-2">
              <SlidersHorizontal size={15} className="shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">Settings</span>
                <span className="block truncate text-[11px] text-muted-foreground">Accessibility and the app tour</span>
              </span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
          </button>

          {/* Send feedback — sign-in is prompted upstream if needed */}
          <button onClick={() => { setOpen(false); onSendFeedback(); }}
            className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card/70 px-3 py-2.5 text-left transition hover:border-primary/40">
            <span className="flex min-w-0 items-center gap-2">
              <MessageSquare size={15} className="shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">Send feedback</span>
                <span className="block truncate text-[11px] text-muted-foreground">Found a bug or have an idea? Tell us</span>
              </span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
          </button>

          <div className="mt-1 border-t border-border pt-1">
            {session ? (
              <button onClick={() => { setOpen(false); onSignOut(); }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <LogOut size={15} /> Sign out
              </button>
            ) : (
              <button onClick={() => { setOpen(false); onSignIn(); }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-primary transition hover:bg-primary/5">
                <LogIn size={15} /> Sign in
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
