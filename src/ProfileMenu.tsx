// Profile menu, anchored to the avatar in the top-right of the header.
// Holds the account summary, the subscription plan (with a jump to the
// Premium page), the accessibility settings (color-blind palette, high
// contrast, reduced motion, larger text), and sign out. Accessibility
// settings work signed-out too — they're stored locally on the device.

import { useEffect, useRef, useState } from "react";
import { Crown, LogIn, LogOut, ChevronRight, Users } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { Profile } from "./db";

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
    return { ...DEFAULT_A11Y, ...JSON.parse(localStorage.getItem("roamly-a11y") ?? "{}") };
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

export function ProfileMenu({ session, profile, isPremium, a11y, setA11y, onSignIn, onSignOut, onOpenPremium, onOpenFriends }: {
  session: Session | null;
  profile: Profile | null;
  isPremium: boolean;
  a11y: A11ySettings;
  setA11y: (next: A11ySettings) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenPremium: () => void;
  onOpenFriends: () => void;
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

  const flip = (key: keyof A11ySettings) => setA11y({ ...a11y, [key]: !a11y[key] });

  return (
    <div ref={rootRef} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Open profile menu" aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-full gradient-primary text-sm font-semibold text-white shadow-glow transition active:scale-95">
        {session ? initials : "☺"}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-2xl border border-border bg-card p-2 shadow-xl">
          {/* Account */}
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full gradient-primary text-sm font-semibold text-white">{session ? initials : "☺"}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{session ? (name ?? "Set a username") : "Not signed in"}</span>
              <span className="block truncate text-xs text-muted-foreground">{session ? email : "Sign in to sync your data"}</span>
            </span>
          </div>

          {/* Plan */}
          {session && (
            <button onClick={() => { setOpen(false); onOpenPremium(); }}
              className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card/70 px-3 py-2.5 text-left transition hover:border-primary/40">
              <span className="flex min-w-0 items-center gap-2">
                <Crown size={15} className="shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{isPremium ? "Premium plan" : "Free plan"}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {isPremium ? "All features unlocked — view details" : "Upgrade for music, hosting, and more"}
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
