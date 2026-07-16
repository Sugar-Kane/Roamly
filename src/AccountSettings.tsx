// The account experience: a focused, mobile-first panel that consolidates
// everything about "you and this account" in one place — profile identity
// (avatar, display name, username), account facts (email, member-since, plan),
// privacy, a full data export, and a guarded account deletion. Replaces the
// grab-bag of account controls that used to be crammed into the profile
// dropdown, which had no way to edit a display name, no data export, and no
// self-service deletion at all.

import { useRef, useState } from "react";
import {
  Camera, Trash2, Check, X, Pencil, Crown, Mail, CalendarDays, ShieldCheck,
  Download, AlertTriangle, Loader2, ChevronRight, Users,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { Modal } from "./Modal";
import {
  updateProfileAvatar, removeProfileAvatar, setDisplayName, deleteAccount,
  exportAccountData, type Profile,
} from "./db";
import { setUsername } from "./rooms";
import { setStatsPublic } from "./gamification";
import { prepareAvatarFile, AVATAR_MAX_BYTES } from "./avatarUpload";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{title}</h3>
      <div className="mt-1.5 overflow-hidden rounded-2xl border border-border bg-card/70">{children}</div>
    </section>
  );
}

function Row({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex items-center gap-3 px-4 py-3 ${className}`}>{children}</div>;
}

function Avatar({ url, initials, className }: { url?: string | null; initials: string; className: string }) {
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full gradient-primary font-semibold text-white ${className}`}>
      {initials}
      {url && <img key={url} src={url} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.hidden = true; }} />}
    </span>
  );
}

// One reusable inline single-field editor (display name / username): a label +
// current value that flips into an input with save/cancel. Keeps the panel from
// repeating the same open/save/error dance twice.
function InlineField({ label, value, placeholder, hint, prefix, onSave }: {
  label: string;
  value: string | null;
  placeholder: string;
  hint?: string;
  prefix?: string;
  onSave: (draft: string) => Promise<string | null>; // resolves to an error message, or null on success
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = () => { setDraft(value ?? ""); setError(null); setEditing(true); };
  const save = async () => {
    setBusy(true);
    setError(null);
    const err = await onSave(draft);
    setBusy(false);
    if (err) { setError(err); return; }
    setEditing(false);
  };

  return (
    <Row className="flex-col items-stretch !gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {!editing && (
          <button onClick={begin} className="flex items-center gap-1 text-xs font-medium text-primary transition hover:opacity-80">
            <Pencil size={12} /> {value ? "Edit" : "Add"}
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center rounded-xl border border-border bg-card px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
              {prefix && <span className="text-sm text-muted-foreground">{prefix}</span>}
              <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
                placeholder={placeholder} className="w-full bg-transparent py-2 text-sm outline-none" />
            </div>
            <button onClick={() => void save()} disabled={busy || !draft.trim()} aria-label="Save"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl gradient-primary text-white disabled:opacity-40">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />}
            </button>
            <button onClick={() => setEditing(false)} disabled={busy} aria-label="Cancel"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground disabled:opacity-40">
              <X size={16} />
            </button>
          </div>
          {hint && !error && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
          {error && <p role="alert" className="mt-1 text-[11px] text-destructive">{error}</p>}
        </div>
      ) : (
        <span className="truncate text-sm text-muted-foreground">
          {value ? `${prefix ?? ""}${value}` : <span className="italic">{placeholder}</span>}
        </span>
      )}
    </Row>
  );
}

function Toggle({ on, onClick, disabled, label }: { on: boolean; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${on ? "bg-primary" : "bg-border"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function AccountSettings({ session, profile, isPremium, onProfileChange, onClose, onSignOut, onOpenPremium, onOpenFriends }: {
  session: Session;
  profile: Profile | null;
  isPremium: boolean;
  onProfileChange: (profile: Profile) => void;
  onClose: () => void;
  onSignOut: () => void;
  onOpenPremium: () => void;
  onOpenFriends: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [statsPublic, setStatsPublicState] = useState(profile?.stats_public ?? false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const email = session.user.email ?? null;
  const name = profile?.display_name || profile?.username || null;
  const initials = (name ?? email ?? "?").slice(0, 2).toUpperCase();
  const memberSince = session.user.created_at
    ? new Date(session.user.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : null;

  const chooseAvatar = async (file: File | undefined) => {
    if (!file || !profile) return;
    if (file.size > AVATAR_MAX_BYTES) { setAvatarError("Choose an image smaller than 15 MB."); return; }
    setAvatarBusy(true);
    setAvatarError(null);
    let prepared: File;
    try {
      prepared = await prepareAvatarFile(file);
    } catch {
      setAvatarBusy(false);
      setAvatarError("Couldn't convert that HEIC photo. Try a JPG or PNG instead.");
      return;
    }
    const result = await updateProfileAvatar(session.user.id, prepared, profile.avatar_path);
    setAvatarBusy(false);
    if (!result.url) { setAvatarError(result.error ?? "Couldn't update that picture."); return; }
    onProfileChange({ ...profile, avatar_path: result.path, avatar_url: result.url });
  };

  const removeAvatar = async () => {
    if (!profile?.avatar_url) return;
    setAvatarBusy(true);
    setAvatarError(null);
    const result = await removeProfileAvatar(session.user.id, profile.avatar_path);
    setAvatarBusy(false);
    if (result.error) { setAvatarError(result.error); return; }
    onProfileChange({ ...profile, avatar_path: null, avatar_url: null });
  };

  const saveDisplayName = async (draft: string): Promise<string | null> => {
    const clean = draft.trim();
    const err = await setDisplayName(clean);
    if (err) return err;
    if (profile) onProfileChange({ ...profile, display_name: clean });
    return null;
  };

  const saveUsername = async (draft: string): Promise<string | null> => {
    const clean = draft.trim().toLowerCase();
    const err = await setUsername(clean);
    if (err) return err;
    if (profile) onProfileChange({ ...profile, username: clean, display_name: profile.display_name ?? clean });
    return null;
  };

  const toggleStatsPublic = async () => {
    if (!isPremium) { onOpenPremium(); return; }
    const next = !statsPublic;
    setStatsPublicState(next);
    setPrivacyError(null);
    const err = await setStatsPublic(next);
    if (err) { setStatsPublicState(!next); setPrivacyError(err); return; }
    if (profile) onProfileChange({ ...profile, stats_public: next });
  };

  const exportData = async () => {
    setExporting(true);
    try {
      const data = await exportAccountData(session.user.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `roamly-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal label="Account settings" onClose={onClose}
      cardClassName="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Account</h2>
        <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground">
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-1">
        {/* Identity header */}
        <div className="mt-4 flex items-center gap-4">
          <Avatar url={profile?.avatar_url} initials={initials} className="h-16 w-16 text-lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{name ?? "Set a display name"}</p>
            {profile?.username
              ? <p className="truncate text-sm text-muted-foreground">@{profile.username}</p>
              : <p className="truncate text-sm text-muted-foreground">{email}</p>}
          </div>
        </div>

        {/* Photo controls */}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" aria-label="Choose profile picture"
          onChange={(e) => { void chooseAvatar(e.target.files?.[0]); e.currentTarget.value = ""; }} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={avatarBusy || !profile} onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full gradient-primary px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50">
            <Camera size={13} /> {avatarBusy ? "Saving…" : profile?.avatar_url ? "Change photo" : "Add photo"}
          </button>
          {profile?.avatar_url && (
            <button type="button" disabled={avatarBusy} onClick={() => void removeAvatar()}
              className="flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-xs text-muted-foreground transition hover:text-destructive disabled:opacity-50">
              <Trash2 size={12} /> Remove
            </button>
          )}
        </div>
        {avatarError
          ? <p role="alert" className="mt-1.5 text-[11px] text-destructive">{avatarError}</p>
          : <p className="mt-1.5 text-[10px] text-muted-foreground">JPG, PNG, WebP, or iPhone HEIC. Maximum 15 MB.</p>}

        {/* Profile */}
        <Section title="Profile">
          <InlineField label="Display name" value={profile?.display_name ?? null}
            placeholder="How your name appears" hint="1–40 characters. Shown to friends and in rooms."
            onSave={saveDisplayName} />
          <div className="border-t border-border" />
          <InlineField label="Username" value={profile?.username ?? null} prefix="@"
            placeholder="Pick a username" hint="3–20 characters: lowercase letters, numbers, underscores. How classmates find you."
            onSave={saveUsername} />
        </Section>

        {/* Account */}
        <Section title="Account">
          <Row>
            <Mail size={16} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Email</span>
              <span className="block truncate text-xs text-muted-foreground">{email ?? "—"}</span>
            </span>
          </Row>
          {memberSince && (
            <>
              <div className="border-t border-border" />
              <Row>
                <CalendarDays size={16} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Member since</span>
                  <span className="block truncate text-xs text-muted-foreground">{memberSince}</span>
                </span>
              </Row>
            </>
          )}
          <div className="border-t border-border" />
          <button onClick={() => { onClose(); onOpenPremium(); }} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-secondary/50">
            <Crown size={16} className="shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{isPremium ? "Premium plan" : "Free plan"}</span>
              <span className="block truncate text-xs text-muted-foreground">{isPremium ? "Manage your subscription" : "See what Premium unlocks"}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
          </button>
          <div className="border-t border-border" />
          <button onClick={() => { onClose(); onOpenFriends(); }} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-secondary/50">
            <Users size={16} className="shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Friends</span>
              <span className="block truncate text-xs text-muted-foreground">Add and manage classmates</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
          </button>
        </Section>

        {/* Privacy */}
        <Section title="Privacy">
          <Row>
            <ShieldCheck size={16} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Share stats with friends</span>
              <span className="block text-xs text-muted-foreground">
                {isPremium ? "Let accepted friends compare stats without asking each time." : "A Premium feature."}
              </span>
              {privacyError && <span role="alert" className="mt-0.5 block text-[11px] text-destructive">{privacyError}</span>}
            </span>
            <Toggle on={isPremium && statsPublic} onClick={() => void toggleStatsPublic()} label="Share stats with friends" />
          </Row>
        </Section>

        {/* Your data */}
        <Section title="Your data">
          <button onClick={() => void exportData()} disabled={exporting} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-secondary/50 disabled:opacity-60">
            <Download size={16} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Download my data</span>
              <span className="block truncate text-xs text-muted-foreground">Export your profile, tasks, sessions, and progress as JSON</span>
            </span>
            {exporting ? <Loader2 size={16} className="shrink-0 animate-spin text-muted-foreground" /> : <ChevronRight size={16} className="shrink-0 text-muted-foreground" />}
          </button>
        </Section>

        {/* Danger zone */}
        <Section title="Danger zone">
          {!confirmingDelete ? (
            <button onClick={() => setConfirmingDelete(true)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-destructive transition hover:bg-destructive/5">
              <Trash2 size={16} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Delete account</span>
                <span className="block truncate text-xs text-destructive/70">Permanently erase your account and all data</span>
              </span>
              <ChevronRight size={16} className="shrink-0" />
            </button>
          ) : (
            <DeleteConfirm onCancel={() => setConfirmingDelete(false)} isPremium={isPremium} onSignOut={onSignOut} />
          )}
        </Section>

        <div className="mt-6 border-t border-border pt-4">
          <button onClick={onSignOut} className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            Sign out
          </button>
        </div>
      </div>
    </Modal>
  );
}

// The deletion gate: spells out exactly what's erased, requires the user to type
// DELETE, then performs the irreversible action and signs out. Kept inline (not
// a nested Modal) so it reads as an in-place escalation of the danger-zone row.
function DeleteConfirm({ onCancel, isPremium, onSignOut }: { onCancel: () => void; isPremium: boolean; onSignOut: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toUpperCase() === "DELETE";

  const run = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const result = await deleteAccount();
    if (result.error) { setBusy(false); setError(result.error); return; }
    // Account is gone; drop the now-orphaned session and reload to a clean slate.
    onSignOut();
    setTimeout(() => { try { window.location.reload(); } catch { /* no-op */ } }, 150);
  };

  return (
    <div className="p-4">
      <div className="flex items-start gap-2.5 rounded-xl bg-destructive/5 p-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
        <div className="text-xs text-foreground/80">
          <p className="font-semibold text-destructive">This can't be undone.</p>
          <p className="mt-1">Deleting your account permanently erases your profile, focus history and streaks, tasks, planned sessions, pets and rewards, friendships, and feedback.</p>
          {isPremium && <p className="mt-1">Your Premium subscription will be canceled so you're not charged again.</p>}
        </div>
      </div>
      <label className="mt-3 block text-xs font-medium text-muted-foreground">Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm</label>
      <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ready && void run()}
        placeholder="DELETE" aria-label="Type DELETE to confirm"
        className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-destructive focus:ring-2 focus:ring-destructive/20" />
      {error && <p role="alert" className="mt-1.5 text-[11px] text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={onCancel} disabled={busy} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-secondary disabled:opacity-50">
          Cancel
        </button>
        <button onClick={() => void run()} disabled={!ready || busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-destructive px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-destructive/90 disabled:opacity-40">
          {busy ? <><Loader2 size={15} className="animate-spin" /> Deleting…</> : "Delete forever"}
        </button>
      </div>
    </div>
  );
}
