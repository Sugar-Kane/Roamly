// Profile menu, anchored to the avatar in the top-right of the header.
// Holds the account summary, the subscription plan (with a jump to the
// Premium page), the accessibility settings (color-blind palette, high
// contrast, reduced motion, larger text), and sign out. Accessibility
// settings work signed-out too — they're stored locally on the device.

import { useEffect, useRef, useState } from "react";
import { Camera, Crown, LogIn, LogOut, ChevronRight, Users, Shield, HelpCircle, MessageSquare, Trash2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { loadPref } from "./storage";
import { removeProfileAvatar, updateProfileAvatar, type Profile } from "./db";
import { currentUploadPeriod, FREE_MONTHLY_UPLOAD_QUOTA, PREMIUM_MONTHLY_UPLOAD_QUOTA } from "./UploadTasks";

// iOS photos are often HEIC/HEIF, which browsers cannot decode or upload as an
// image. Convert to JPEG on the client (the WASM decoder is dynamically
// imported so it only loads when a HEIC file is actually chosen). Non-HEIC
// files pass straight through untouched.
async function maybeConvertHeic(file: File): Promise<File> {
  const isHeic = /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  if (!isHeic) return file;
  const heic2any = (await import("heic2any")).default;
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  return new File([blob], file.name.replace(/\.hei[cf]$/i, ".jpg"), { type: "image/jpeg" });
}

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

const A11Y_OPTIONS: { key: keyof A11ySettings; label: string; hint: string }[] = [
  { key: "colorBlind", label: "Color-blind friendly", hint: "Blue/orange timer and status colors" },
  { key: "highContrast", label: "High contrast", hint: "Stronger text and borders" },
  { key: "reduceMotion", label: "Reduce motion", hint: "Minimize animations" },
  { key: "largeText", label: "Larger text", hint: "Increase the app's font size" },
];

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-primary" : "bg-border"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function ProfileAvatar({ url, initials, className }: { url?: string | null; initials: string; className: string }) {
  return <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full gradient-primary font-semibold text-white ${className}`}>
    {initials}
    {url && <img key={url} src={url} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />}
  </span>;
}

export function ProfileMenu({ session, profile, isPremium, a11y, setA11y, onProfileChange, onSignIn, onSignOut, onOpenPremium, onOpenFriends, isAdmin, onOpenAdmin, onReplayTutorial, onSendFeedback }: {
  session: Session | null;
  profile: Profile | null;
  isPremium: boolean;
  a11y: A11ySettings;
  setA11y: (next: A11ySettings) => void;
  onProfileChange: (profile: Profile) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenPremium: () => void;
  onOpenFriends: () => void;
  isAdmin: boolean;
  onOpenAdmin: () => void;
  onReplayTutorial: () => void;
  onSendFeedback: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const flip = (key: keyof A11ySettings) => setA11y({ ...a11y, [key]: !a11y[key] });

  const chooseAvatar = async (file: File | undefined) => {
    if (!file || !session || !profile) return;
    setAvatarBusy(true);
    setAvatarError(null);
    // iPhones hand back HEIC/HEIF, which browsers can't render or upload as an
    // image. Convert to JPEG first (the decoder is loaded only when needed).
    let prepared: File;
    try {
      prepared = await maybeConvertHeic(file);
    } catch {
      setAvatarBusy(false);
      setAvatarError("Couldn't read that HEIC photo. Try a JPG or PNG.");
      return;
    }
    const result = await updateProfileAvatar(session.user.id, prepared, profile.avatar_path);
    setAvatarBusy(false);
    if (!result.url) { setAvatarError(result.error ?? "Couldn't update that picture."); return; }
    onProfileChange({ ...profile, avatar_path: result.path, avatar_url: result.url });
  };

  const removeAvatar = async () => {
    if (!session || !profile?.avatar_url) return;
    setAvatarBusy(true);
    setAvatarError(null);
    const result = await removeProfileAvatar(session.user.id, profile.avatar_path);
    setAvatarBusy(false);
    if (result.error) { setAvatarError(result.error); return; }
    onProfileChange({ ...profile, avatar_path: null, avatar_url: null });
  };

  return (
    <div ref={rootRef} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Open profile menu" aria-expanded={open}
        className="rounded-full shadow-glow transition active:scale-95">
        <ProfileAvatar url={session ? profile?.avatar_url : null} initials={session ? initials : "☺"} className="h-9 w-9 text-sm" />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-2xl border border-border bg-card p-2 shadow-xl">
          {/* Account */}
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
            <ProfileAvatar url={session ? profile?.avatar_url : null} initials={session ? initials : "☺"} className="h-10 w-10 text-sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{session ? (name ?? "Set a username") : "Not signed in"}</span>
              <span className="block truncate text-xs text-muted-foreground">{session ? email : "Sign in to sync your data"}</span>
            </span>
          </div>

          {session && (
            <div className="mb-1 rounded-xl border border-border bg-card/70 px-3 py-2.5">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" aria-label="Choose profile picture"
                onChange={(event) => { void chooseAvatar(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={avatarBusy || !profile} onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-full gradient-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  <Camera size={13} /> {avatarBusy ? "Saving…" : profile?.avatar_url ? "Change photo" : "Add photo"}
                </button>
                {profile?.avatar_url && <button type="button" disabled={avatarBusy} onClick={() => void removeAvatar()}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-destructive disabled:opacity-50">
                  <Trash2 size={12} /> Remove
                </button>}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">JPG, PNG, or WebP. Maximum 15 MB.</p>
              {avatarError && <p role="alert" className="mt-1 text-[11px] text-destructive">{avatarError}</p>}
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

          {/* App tour — works signed-out too */}
          <button onClick={() => { setOpen(false); onReplayTutorial(); }}
            className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card/70 px-3 py-2.5 text-left transition hover:border-primary/40">
            <span className="flex min-w-0 items-center gap-2">
              <HelpCircle size={15} className="shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">App tour</span>
                <span className="block truncate text-[11px] text-muted-foreground">Replay the quick walkthrough of every feature</span>
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

          {/* Accessibility */}
          <p className="mt-2 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Accessibility</p>
          <div className="mt-1 space-y-0.5">
            {A11Y_OPTIONS.map((o) => (
              <div key={o.key} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-sm">{o.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
                </span>
                <Toggle on={a11y[o.key]} onClick={() => flip(o.key)} label={o.label} />
              </div>
            ))}
          </div>

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
