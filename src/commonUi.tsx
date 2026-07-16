import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Check, Palette, Flame, Bell, BellOff, LogIn, Volume2, Lock, HelpCircle, Sprout, Crown } from "lucide-react";
import { THEMES } from "./data";
import { loadPref, savePref } from "./storage";
import { Modal } from "./Modal";
import { NotificationsBell } from "./Notifications";
import { ProfileMenu, type A11ySettings } from "./ProfileMenu";
import type { useEndOfPhaseAlerts } from "./useEndOfPhaseAlerts";
import type { Profile } from "./db";
import type { Session } from "@supabase/supabase-js";
import type { View, NavItem, CustomMethod } from "./appTypes";

// Slim banner while the device reports itself offline — so a failed sync reads
// as "you're offline" instead of the app silently showing stale/empty data.
// Signed-out demo mode works fully offline, so this is purely informational.
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="sticky top-0 z-[100] flex items-center justify-center gap-2 bg-foreground/90 px-4 py-1.5 text-center text-xs font-medium text-background">
      <BellOff size={13} /> You're offline. Changes will sync when you reconnect.
    </div>
  );
}

export function StreakBadge({ streak }: { streak: number }) {
  if (streak <= 0) return null;
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
      <Flame size={13} /> {streak} day{streak === 1 ? "" : "s"}
    </span>
  );
}

export function Header({ isPremium, streak, session, profile, onProfileChange, onSignIn, onSignOut, onOpenRoom, onOpenFriends, onOpenPlannedStudy, a11y, setA11y, onOpenPremium, confettiOn, onToggleConfetti, isAdmin, onOpenAdmin, onOpenTutorial, themeId, setThemeId, onGoHome, onOpenFeedback }: {
  isPremium: boolean;
  streak: number;
  session: Session | null;
  profile: Profile | null;
  onProfileChange: (profile: Profile) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenRoom: (roomId: string) => void;
  onOpenFriends: () => void;
  onOpenPlannedStudy: () => void;
  a11y: A11ySettings;
  setA11y: (next: A11ySettings) => void;
  onOpenPremium: () => void;
  confettiOn: boolean;
  onToggleConfetti: () => void;
  isAdmin: boolean;
  onOpenAdmin: () => void;
  onOpenTutorial: () => void;
  themeId: string;
  setThemeId: (id: string) => void;
  onGoHome: () => void;
  onOpenFeedback: () => void;
}) {
  // Single row on every screen size: the avatar (with the profile menu behind
  // it) is always pinned to the top right. Plan status and sign out live
  // inside the menu instead of loose header chips.
  return (
    <header className="flex items-center justify-between gap-1.5 sm:gap-3">
      <button onClick={onGoHome} aria-label="Go to the Focus home screen"
        className="flex shrink-0 items-baseline gap-3 rounded-lg transition hover:opacity-80">
        <span className="font-display text-xl font-semibold tracking-tight text-gradient sm:text-2xl">Roamly</span>
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.22em] text-primary sm:inline">Focus</span>
      </button>
      <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
        <span className="hidden sm:block"><StreakBadge streak={streak} /></span>
        <button onClick={onOpenTutorial} aria-label="Replay the app tour"
          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
          <HelpCircle size={15} />
        </button>
        <ThemeMenu themeId={themeId} setThemeId={setThemeId} />
        {session && <NotificationsBell session={session} onOpenRoom={onOpenRoom} onOpenFriends={onOpenFriends} onOpenPlannedStudy={onOpenPlannedStudy} />}
        {/* Wait for a signed-in profile before rendering plan status so a
            Premium member never sees an upgrade prompt flash during load. */}
        {isPremium ? (
          <button onClick={onOpenPremium} aria-label="Premium account"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 font-semibold text-primary transition hover:bg-primary/15 active:scale-95 sm:flex sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs">
            <Crown size={15} /> <span className="hidden sm:inline">Premium</span>
          </button>
        ) : (!session || profile) && (
          <button onClick={onOpenPremium} aria-label="Try Premium"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full gradient-primary font-semibold text-white shadow-glow transition active:scale-95 sm:flex sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs">
            <Crown size={15} /> <span className="hidden sm:inline">Try Premium</span>
          </button>
        )}
        {!session && (
          <button onClick={onSignIn} aria-label="Sign in" className="grid h-9 w-9 shrink-0 place-items-center rounded-full gradient-primary font-semibold text-white shadow-glow transition active:scale-95 sm:flex sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs">
            <LogIn size={15} /> <span className="hidden sm:inline">Sign in</span>
          </button>
        )}
        <ProfileMenu session={session} profile={profile} onProfileChange={onProfileChange} isPremium={isPremium}
          a11y={a11y} setA11y={setA11y} confettiOn={confettiOn} onToggleConfetti={onToggleConfetti}
          onSignIn={onSignIn} onSignOut={onSignOut} onOpenPremium={onOpenPremium} onOpenFriends={onOpenFriends}
          isAdmin={isAdmin} onOpenAdmin={onOpenAdmin} onReplayTutorial={onOpenTutorial} onSendFeedback={onOpenFeedback} />
      </div>
    </header>
  );
}

export function SignInPrompt({ onSignIn, message }: { onSignIn: () => void; message: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card/60 p-4">
      <span className="text-sm text-muted-foreground">{message}</span>
      <button onClick={onSignIn} className="flex shrink-0 items-center gap-1.5 rounded-full gradient-primary px-4 py-2 text-xs font-semibold text-white shadow-glow transition active:scale-95">
        <LogIn size={13} /> Sign in
      </button>
    </div>
  );
}

// Account-only gate for the Garden tab: the tab stays visible (advertising the
// feature) but its contents are locked behind sign-in for guests.
export function GardenLock({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="flex items-center gap-2 font-display text-3xl font-semibold"><Sprout size={26} className="text-roamly-green" /> Garden</h1>
      <div className="mt-6 rounded-2xl border border-border bg-card/80 p-8 text-center shadow-sm">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary"><Lock size={24} /></span>
        <h2 className="mt-4 font-display text-xl font-semibold">Sign in to unlock your Garden</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">Earn XP, level up, collect pets, and grow plants as you study. Your progress saves to your account and syncs across devices.</p>
        <button onClick={onSignIn} className="mt-5 inline-flex items-center gap-1.5 rounded-full gradient-primary px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-95">
          <LogIn size={15} /> Sign in
        </button>
      </div>
    </div>
  );
}

export function NumberField({ value, unit, min, max, label, onChange }: {
  value: number; unit: string; min: number; max: number; label: string; onChange: (value: number) => void;
}) {
  // Local string state lets the user clear and retype freely; we commit a clamped
  // number on blur or Enter so typing never fights the value mid-edit.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = parseInt(draft, 10);
    const next = isNaN(n) ? value : Math.max(min, Math.min(max, n));
    onChange(next);
    setDraft(String(next));
  };

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Decrease ${label}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
        <Minus size={15} />
      </button>
      <div className="flex w-[88px] items-center justify-center rounded-lg border border-border bg-card px-1 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <input
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          aria-label={`${label}${unit ? ` in ${unit}` : ""}`}
          className="w-9 bg-transparent py-1.5 text-right font-mono text-sm tabular-nums outline-none" />
        {unit && <span className="pl-1 pr-1 font-mono text-sm text-muted-foreground">{unit}</span>}
      </div>
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label={`Increase ${label}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
        <Plus size={15} />
      </button>
    </div>
  );
}

export function CustomEditor({ custom, setCustom, onSave }: {
  custom: CustomMethod; setCustom: (next: CustomMethod) => void; onSave: () => void;
}) {
  const rows: { key: keyof CustomMethod; label: string; unit: string; min: number; max: number }[] = [
    { key: "focus", label: "Focus length", unit: "min", min: 1, max: 180 },
    { key: "short", label: "Short break", unit: "min", min: 1, max: 60 },
    { key: "long", label: "Long break", unit: "min", min: 1, max: 90 },
    { key: "cycles", label: "Blocks before long break", unit: "", min: 1, max: 10 },
  ];

  return (
    <div className="mt-3 rounded-2xl border border-border bg-card/70 p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Custom settings</p>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-sm">{r.label}</span>
            <NumberField value={custom[r.key]} unit={r.unit} min={r.min} max={r.max} label={r.label}
              onChange={(v: number) => setCustom({ ...custom, [r.key]: v })} />
          </div>
        ))}
      </div>
      <button onClick={onSave}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl gradient-primary py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-[0.98]">
        <Check size={16} /> Save and go to timer
      </button>
      <p className="mt-2 text-[11px] text-muted-foreground">Type a value or use the buttons. Changing a value resets the current timer.</p>
    </div>
  );
}

// Round header button opening a dropdown of themes (moved out of the front
// page). Same open/outside-click/Escape mechanics as ProfileMenu.
export function ThemeMenu({ themeId, setThemeId }: { themeId: string; setThemeId: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
  return (
    <div ref={rootRef} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Change theme" aria-expanded={open}
        className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
        <Palette size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card p-2 shadow-xl">
          <p className="px-3 pt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Theme</p>
          <div className="mt-1 space-y-1">
            {THEMES.map((t: any) => {
              const active = themeId === t.id;
              return (
                <button key={t.id} onClick={() => { setThemeId(t.id); setOpen(false); }} aria-pressed={active}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-primary bg-primary/5" : "border-border bg-card/70 hover:border-primary/40"}`}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border shadow-sm"
                    style={{ background: `linear-gradient(135deg, ${t.grad[0]}, ${t.grad[1]})` }}>
                    <span className="h-2.5 w-2.5 rounded-full border border-white/50" style={{ background: t.ring }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{t.hint}</span>
                  </span>
                  {active && <Check size={15} className="shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function NotificationToggle({ alerts }: { alerts: ReturnType<typeof useEndOfPhaseAlerts> }) {
  const soundToggle = (
    <button role="switch" aria-checked={alerts.soundEnabled} onClick={() => alerts.setSoundEnabled(!alerts.soundEnabled)}
      className={`flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition ${alerts.soundEnabled ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
      {alerts.soundEnabled ? <Volume2 size={13} /> : <BellOff size={13} />} Completion sound {alerts.soundEnabled ? "on" : "off"}
    </button>
  );
  if (alerts.permission === "unsupported") return soundToggle;
  if (alerts.permission === "granted") {
    return (
      <><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bell size={13} /> Notifications on</span>{soundToggle}</>
    );
  }
  if (alerts.permission === "denied") {
    return (
      <><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><BellOff size={13} /> Notifications blocked in browser settings</span>{soundToggle}</>
    );
  }
  return (
    <><button onClick={alerts.requestPermission} className="flex items-center gap-1.5 self-start rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/15"><Bell size={13} /> Enable notifications</button>{soundToggle}</>
  );
}

// A short explainer of the Pomodoro method at the top of the main page, so
// newcomers understand what the timer is doing (from user feedback). Dismissible
// and remembered; collapses to a small reopen link once dismissed.
export function PomodoroExplainer() {
  const [open, setOpen] = useState(() => loadPref("roamly-pomodoro-explainer-seen") !== "1");
  const dismiss = () => { savePref("roamly-pomodoro-explainer-seen", "1"); setOpen(false); };
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline">
        <HelpCircle size={13} /> What's the Pomodoro method?
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><HelpCircle size={15} className="text-primary" /> What's the Pomodoro method?</h2>
        <button onClick={dismiss} className="shrink-0 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">Got it</button>
      </div>
      <p className="mt-2.5 text-sm text-muted-foreground">
        It's a simple way to study without burning out: focus in short, timed blocks, classically <span className="font-medium text-foreground">25 minutes</span>, then take a <span className="font-medium text-foreground">5-minute break</span>. After about four blocks you take a longer break. The countdown keeps you honest during focus, and the breaks keep you fresh.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Just press <span className="font-medium text-foreground">Start</span> below to begin a block, or use <span className="font-medium text-foreground">Select timer</span> to pick a different rhythm.
      </p>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-primary">{sub}</div>}
    </div>
  );
}

export function PremiumAnalyticsGate({ title, description, onUpgrade }: { title: string; description: string; onUpgrade: () => void }) {
  return (
    <section className="mt-6 rounded-2xl border border-primary/30 bg-card/80 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="flex items-center gap-1 text-xs font-medium text-primary"><Crown size={12} /> Premium</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <button onClick={onUpgrade} aria-label={`Unlock ${title} with Premium`} className="mt-3 rounded-full gradient-primary px-4 py-2 text-xs font-semibold text-white shadow-glow transition active:scale-95">
        Unlock with Premium
      </button>
    </section>
  );
}

export function Upsell({ onClose, onUpgrade, onBuyCredits }: { onClose: () => void; onUpgrade: () => void; onBuyCredits?: () => void }) {
  return (
    // z-[130] so the upsell is visible even when triggered from inside the
    // focus-mode overlay (which sits at z-[120]).
    <Modal label="Premium feature" onClose={onClose}
      overlayClassName="fixed inset-0 z-[130] grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm"
      cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-xl">
        <div className="grid h-12 w-12 place-items-center rounded-2xl gradient-primary shadow-glow"><Crown className="text-white" /></div>
        <h3 className="mt-4 font-display text-xl font-semibold">This is a Premium feature</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">Unlock planned study, premium methods, advanced analytics, 10 AI note uploads a month, and hosting your own study rooms.</p>
        <button onClick={onUpgrade} className="mt-5 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95">Unlock with Premium</button>
        {onBuyCredits && (
          <button onClick={onBuyCredits} className="mt-2 w-full rounded-full border border-primary/50 bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20">
            Or buy AI upload credits, no subscription
          </button>
        )}
        <button onClick={onClose} className="mt-2 w-full rounded-full py-2 text-sm text-muted-foreground">Maybe later</button>
    </Modal>
  );
}

export function BottomNav({ nav, view, setView }: { nav: NavItem[]; view: View; setView: (v: View) => void }) {
  // iOS Safari drags position:fixed elements up with the on-screen keyboard
  // (and can leave them stranded mid-page). Hide the nav while the keyboard
  // is open — the visualViewport shrinking well below the layout viewport is
  // the reliable signal. No-ops on desktop.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboardOpen(vv.height < window.innerHeight - 150);
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);
  if (keyboardOpen) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg">
      <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
        {nav.map((n: any) => {
          const Icon = n.icon;
          const active = view === n.id;
          return (
            <button key={n.id} onClick={() => setView(n.id)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              <span className="relative">
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                {n.locked && <Lock size={10} className="absolute -right-1.5 -top-1 rounded-full bg-card text-muted-foreground" />}
              </span>
              <span className="text-[10px] font-medium">{n.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
