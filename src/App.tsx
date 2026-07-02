import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Timer, ListChecks, BarChart3, Users, Sparkles, Check, Plus, Minus, Crown, Play, Pause, RotateCcw, SkipForward, X, Music, Palette, Flame, Bell, BellOff, CalendarClock, LogIn } from "lucide-react";
import { METHODS, SEED_TASKS, WEEK_DATA, SUBJECT_SPLIT, THEMES, ROOMS, type Task } from "./data";
import { useTimer, fmt, type Phase } from "./useTimer";
import { SPOTIFY_PRESETS, parseSpotifyUrl, toEmbedSrc, embedHeight, type SpotifyEmbedType } from "./spotify";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, PieChart, Pie, Cell } from "recharts";
import { supabase } from "./supabaseClient";
import { fetchProfile, updateGoalAndExam, logFocusMinutes, fetchRecentSessions, getAccessToken, fetchTasks, createTask, updateTask, deleteTask, type Profile } from "./db";
import { addSession, computeStreak, minutesToday, dateKey, type FocusSession } from "./streaks";
import { useEndOfPhaseAlerts } from "./useEndOfPhaseAlerts";
import { AuthPanel } from "./Auth";
import type { Session } from "@supabase/supabase-js";

type View = "focus" | "tasks" | "analytics" | "rooms" | "premium";

export default function App() {
  const [view, setView] = useState<View>("focus");
  const [methodId, setMethodId] = useState("classic");
  const [themeId, setThemeId] = useState("coffee");
  const [tasks, setTasks] = useState<Task[]>(SEED_TASKS);
  const [activeTask, setActiveTask] = useState<string | null>("t1");
  const [showUpsell, setShowUpsell] = useState(false);
  // User-editable values for the Custom method (minutes).
  const [custom, setCustom] = useState({ focus: 30, short: 7, long: 20, cycles: 4 });

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [showAuth, setShowAuth] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const alerts = useEndOfPhaseAlerts();

  const isPremium = profile?.is_premium ?? false;
  const dailyGoal = profile?.daily_goal_minutes ?? 120;
  const examDate = profile?.exam_date ?? null;
  const streak = useMemo(() => computeStreak(sessions), [sessions]);
  const todayMinutes = useMemo(() => minutesToday(sessions), [sessions]);

  const method = useMemo(() => {
    const base = METHODS.find((m) => m.id === methodId)!;
    return base.id === "custom" ? { ...base, ...custom } : base;
  }, [methodId, custom]);
  const theme = useMemo(() => THEMES.find((t) => t.id === themeId)!, [themeId]);

  // Track the signed-in session.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load this user's profile, recent focus sessions, and tasks whenever they sign
  // in/out. Signed-out users keep working with the local in-memory demo tasks.
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) {
      setProfile(null);
      setSessions([]);
      setTasks(SEED_TASKS);
      setActiveTask(SEED_TASKS[0]?.id ?? null);
      return;
    }
    fetchProfile(userId).then(setProfile);
    fetchRecentSessions(userId).then(setSessions);
    fetchTasks(userId).then((rows) => {
      setTasks(rows);
      setActiveTask(rows[0]?.id ?? null);
    });
  }, [session?.user.id]);

  // Reflect a Stripe webhook's is_premium update live, without a manual refresh.
  useEffect(() => {
    if (!supabase || !session?.user.id) return;
    const client = supabase; // narrowed to non-null for the cleanup closure below
    const channel = client
      .channel(`profile-${session.user.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${session.user.id}` },
        (payload) => setProfile(payload.new as Profile))
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [session?.user.id]);

  const handlePhaseComplete = useCallback((finishedPhase: Phase) => {
    alerts.notify(finishedPhase);
    if (finishedPhase === "focus" && session?.user.id) {
      setSessions((prev) => addSession(prev, method.focus));
      logFocusMinutes(dateKey(), method.focus);
    }
  }, [alerts.notify, session?.user.id, method.focus]);

  const timer = useTimer(method, handlePhaseComplete);

  const nav: { id: View; label: string; icon: typeof Timer }[] = [
    { id: "focus", label: "Focus", icon: Timer },
    { id: "tasks", label: "Tasks", icon: ListChecks },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "rooms", label: "Rooms", icon: Users },
    { id: "premium", label: "Premium", icon: Sparkles },
  ];

  const gateThen = (fn: () => void) => (isPremium ? fn() : setShowUpsell(true));
  const onSignIn = () => setShowAuth(true);
  const onSignOut = () => supabase?.auth.signOut();

  const setDailyGoal = (minutes: number) => {
    setProfile((p) => (p ? { ...p, daily_goal_minutes: minutes } : p));
    updateGoalAndExam({ daily_goal_minutes: minutes });
  };
  const setExamDate = (date: string | null) => {
    setProfile((p) => (p ? { ...p, exam_date: date } : p));
    updateGoalAndExam({ exam_date: date });
  };

  // Task CRUD: optimistic local update always; when signed in, also persist to
  // Supabase (tasks table) so they survive across devices/sessions.
  const addTask = useCallback((title: string, tag: string) => {
    const userId = session?.user.id;
    if (userId) {
      createTask(userId, title, tag).then((row) => {
        if (row) setTasks((prev) => [row, ...prev]);
      });
    } else {
      setTasks((prev) => [{ id: crypto.randomUUID(), title, tag, done: false, poms: 0, est: 2 }, ...prev]);
    }
  }, [session?.user.id]);

  const toggleTask = useCallback((id: string) => {
    const current = tasks.find((t) => t.id === id);
    if (!current) return;
    const nextDone = !current.done;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: nextDone } : t)));
    if (session?.user.id) updateTask(id, { done: nextDone });
  }, [tasks, session?.user.id]);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (session?.user.id) deleteTask(id);
  }, [session?.user.id]);

  // Tasks generated server-side by /api/generate-tasks are already persisted —
  // just prepend them to local state, no additional Supabase call needed.
  const addImportedTasks = useCallback((rows: Task[]) => {
    setTasks((prev) => [...rows, ...prev]);
  }, []);

  const startCheckout = useCallback(async () => {
    if (!session) { setShowAuth(true); return; }
    setCheckoutError(null);
    setCheckoutLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) { setCheckoutLoading(false); setShowAuth(true); return; }
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setCheckoutError("Payments aren't set up yet — check back soon."); setCheckoutLoading(false); return; }
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setCheckoutError("Couldn't reach the payments server. Try again soon.");
      setCheckoutLoading(false);
    }
  }, [session]);

  // Apply the active theme's palette to the document root so every CSS variable
  // (background, card, primary, etc.) updates live across the whole app.
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.classList.toggle("dark", !!theme.dark);
  }, [theme]);

  return (
    <div className="min-h-screen text-foreground font-sans" style={{ background: `linear-gradient(160deg, ${theme.grad[0]} 0%, ${theme.grad[1]} 90%)` }}>
      <div className="relative mx-auto flex max-w-6xl flex-col px-5 pb-28 pt-7 md:px-8">
        <Header isPremium={isPremium} streak={streak} session={session} onSignIn={onSignIn} onSignOut={onSignOut} />
        <ThemePicker themeId={themeId} setThemeId={setThemeId} />
        <main className="mt-8 flex-1">
          {view === "focus" && (
            <FocusView method={method} methodId={methodId} setMethodId={setMethodId} timer={timer} theme={theme}
              tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask}
              custom={custom} setCustom={setCustom}
              isPremium={isPremium} gateThen={gateThen}
              examDate={examDate} setExamDate={setExamDate} alerts={alerts}
              session={session} onSignIn={onSignIn} />
          )}
          {view === "tasks" && (
            <TasksView tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask}
              addTask={addTask} toggleTask={toggleTask} removeTask={removeTask}
              session={session} onSignIn={onSignIn}
              profile={profile} addImportedTasks={addImportedTasks} onSubscribe={startCheckout} />
          )}
          {view === "analytics" && (
            <AnalyticsView isPremium={isPremium} onUpsell={() => setShowUpsell(true)}
              streak={streak} todayMinutes={todayMinutes} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal}
              session={session} onSignIn={onSignIn} />
          )}
          {view === "rooms" && <RoomsView isPremium={isPremium} gateThen={gateThen} />}
          {view === "premium" && (
            <PremiumView isPremium={isPremium} session={session} onSubscribe={startCheckout}
              checkoutLoading={checkoutLoading} checkoutError={checkoutError} />
          )}
        </main>
      </div>
      <BottomNav nav={nav} view={view} setView={setView} />
      {showUpsell && <Upsell onClose={() => setShowUpsell(false)} onUpgrade={() => { setShowUpsell(false); startCheckout(); }} />}
      {showAuth && <AuthPanel onClose={() => setShowAuth(false)} />}
    </div>
  );
}

function StreakBadge({ streak }: any) {
  if (streak <= 0) return null;
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
      <Flame size={13} /> {streak} day{streak === 1 ? "" : "s"}
    </span>
  );
}

function Header({ isPremium, streak, session, onSignIn, onSignOut }: any) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-2xl font-semibold tracking-tight text-gradient">Roamly</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">Focus</span>
      </div>
      <div className="flex items-center gap-3">
        <StreakBadge streak={streak} />
        {isPremium && (
          <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Crown size={13} /> Premium
          </span>
        )}
        {session ? (
          <button onClick={onSignOut} className="text-xs text-muted-foreground underline">Sign out</button>
        ) : (
          <button onClick={onSignIn} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
            <LogIn size={13} /> Sign in
          </button>
        )}
        <div className="grid h-9 w-9 place-items-center rounded-full gradient-primary text-sm font-semibold text-white shadow-glow">PA</div>
      </div>
    </header>
  );
}

function TimeDisplay({ value, className }: { value: string; className?: string }) {
  // Render each character in a fixed-width slot so the total width never changes
  // as digits change (Fraunces digits aren't equal-width and tabular-nums is unreliable).
  return (
    <span className={`inline-flex leading-none ${className ?? ""}`} style={{ fontVariantNumeric: "tabular-nums" }} aria-label={value}>
      {value.split("").map((ch, i) => (
        <span key={i} className="inline-flex justify-center" style={{ width: ch === ":" ? "0.42em" : "0.62em" }}>
          {ch}
        </span>
      ))}
    </span>
  );
}

function SignInPrompt({ onSignIn, message }: any) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card/60 p-4">
      <span className="text-sm text-muted-foreground">{message}</span>
      <button onClick={onSignIn} className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:border-primary/40">
        Sign in
      </button>
    </div>
  );
}

function ExamCountdownBar({ examDate, setExamDate }: any) {
  const [editing, setEditing] = useState(!examDate);
  const [draft, setDraft] = useState(examDate ?? "");

  const save = () => {
    if (!draft) return;
    setExamDate(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} className="text-primary" />
          <span className="text-sm font-medium">Set your PANCE exam date</span>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <button onClick={save} disabled={!draft}
            className="rounded-xl gradient-primary px-3 py-1.5 text-xs font-semibold text-white shadow-glow disabled:opacity-40">
            Save
          </button>
          {examDate && (
            <button onClick={() => { setDraft(examDate); setEditing(false); }} className="text-xs text-muted-foreground underline">
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exam = new Date(`${examDate}T00:00:00`); // local-time parse, not UTC
  const days = Math.ceil((exam.getTime() - today.getTime()) / 86400000);

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <CalendarClock size={16} className="text-primary" />
        <span className="text-sm">
          {days > 0 && <><span className="font-display text-lg font-semibold">{days}</span> day{days === 1 ? "" : "s"} until your exam</>}
          {days === 0 && "Your exam is today — good luck!"}
          {days < 0 && "Your exam date has passed"}
        </span>
      </div>
      <button onClick={() => setEditing(true)} className="text-xs text-muted-foreground underline">Change</button>
    </div>
  );
}

function NotificationToggle({ alerts }: any) {
  if (alerts.permission === "unsupported") return null;
  if (alerts.permission === "granted") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Bell size={13} /> Notifications on
      </span>
    );
  }
  if (alerts.permission === "denied") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellOff size={13} /> Notifications blocked in browser settings
      </span>
    );
  }
  return (
    <button onClick={alerts.requestPermission}
      className="flex items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
      <Bell size={13} /> Enable notifications
    </button>
  );
}

function FocusView({ method, methodId, setMethodId, timer, theme, tasks, activeTask, setActiveTask, custom, setCustom, isPremium, gateThen, examDate, setExamDate, alerts, session, onSignIn }: any) {
  const phaseLabel = timer.phase === "focus" ? "Focus" : timer.phase === "short" ? "Short break" : "Long break";
  const task = tasks.find((t: Task) => t.id === activeTask);
  const ring = timer.phase === "focus" ? theme.ring : theme.rest;
  const timerRef = useRef<HTMLElement>(null);
  const scrollToTimer = () => timerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-8">
      {session ? (
        <ExamCountdownBar examDate={examDate} setExamDate={setExamDate} />
      ) : (
        <SignInPrompt onSignIn={onSignIn} message="Sign in to track your exam countdown." />
      )}

      <section ref={timerRef} className="overflow-hidden rounded-3xl border border-border bg-card/80 p-6 shadow-sm backdrop-blur sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
          <div className="flex shrink-0 flex-col items-center lg:items-start">
            <span className="font-mono text-xs uppercase tracking-[0.25em]" style={{ color: ring }}>{phaseLabel}</span>
            <TimeDisplay value={fmt(timer.secondsLeft)} className="font-display text-7xl font-medium tracking-tight sm:text-8xl" />
            <span className="mt-1 text-sm text-muted-foreground">{method.name}</span>
          </div>

          <div className="flex flex-1 flex-col gap-5">
            <div>
              <div className="h-3 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}>
                <div className="h-full rounded-full" style={{ width: `${timer.progress * 100}%`, background: ring, transition: "width 1s linear" }} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex gap-1.5">
                  {Array.from({ length: method.cycles }).map((_, i) => (
                    <span key={i} className="h-1.5 w-6 rounded-full" style={{ background: i < timer.completedFocus % method.cycles ? ring : "hsl(var(--border))" }} />
                  ))}
                </div>
                {task && (
                  <span className="truncate pl-3 text-sm text-muted-foreground">
                    <span className="text-foreground">{task.title}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={timer.running ? timer.pause : timer.start}
                className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl font-semibold text-white shadow-glow transition active:scale-[0.98]"
                style={{ background: ring }} aria-label={timer.running ? "Pause" : "Start"}>
                {timer.running ? <><Pause size={22} fill="currentColor" /> Pause</> : <><Play size={22} fill="currentColor" /> Start</>}
              </button>
              <button onClick={timer.reset} className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground" aria-label="Reset">
                <RotateCcw size={19} />
              </button>
              <button onClick={timer.skip} className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground" aria-label="Skip">
                <SkipForward size={19} />
              </button>
            </div>
            <NotificationToggle alerts={alerts} />
          </div>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <div>
            <h2 className="mb-3 font-display text-lg font-semibold">Method</h2>
            <div className="grid grid-cols-2 gap-2.5">
              {METHODS.map((m) => {
                const locked = m.premium && !isPremium;
                const active = m.id === methodId;
                return (
                  <button key={m.id} onClick={() => (locked ? gateThen(() => setMethodId(m.id)) : setMethodId(m.id))}
                    className={`relative rounded-2xl border p-3 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card/70 hover:border-primary/40"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{m.name}</span>
                      {locked && <Crown size={13} className="text-primary" />}
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{m.blurb}</p>
                  </button>
                );
              })}
            </div>
            {methodId === "custom" && <CustomEditor custom={custom} setCustom={setCustom} onSave={scrollToTimer} />}
          </div>
          <div>
            <h2 className="mb-3 font-display text-lg font-semibold">Up next</h2>
            <div className="space-y-2">
              {tasks.filter((t: Task) => !t.done).slice(0, 3).map((t: Task) => (
                <button key={t.id} onClick={() => setActiveTask(t.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${activeTask === t.id ? "border-primary bg-primary/5" : "border-border bg-card/70 hover:border-primary/40"}`}>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-[10px] font-semibold text-primary">{t.tag.slice(0, 2)}</span>
                  <span className="flex-1 truncate text-sm">{t.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">{t.poms}/{t.est}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <MusicPanel isPremium={isPremium} gateThen={gateThen} />
        </div>
      </div>
    </div>
  );
}

function NumberField({ value, unit, min, max, label, onChange }: any) {
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

function CustomEditor({ custom, setCustom, onSave }: any) {
  const rows: { key: string; label: string; unit: string; min: number; max: number }[] = [
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
          <div key={r.key} className="flex items-center justify-between gap-3">
            <span className="text-sm">{r.label}</span>
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

function ThemePicker({ themeId, setThemeId }: any) {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Palette size={16} className="text-primary" />
        <h2 className="font-display text-lg font-semibold">Theme</h2>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {THEMES.map((t: any) => {
          const active = themeId === t.id;
          const nameColor = t.dark ? "#E8E6F0" : `hsl(${t.vars["--foreground"]})`;
          return (
            <button key={t.id} onClick={() => setThemeId(t.id)}
              className={`relative flex h-24 flex-col justify-between overflow-hidden rounded-xl p-2.5 text-left shadow-sm transition ${active ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : "hover:brightness-95"}`}
              style={{
                background: `linear-gradient(135deg, ${t.grad[0]}, ${t.grad[1]})`,
                border: `2px solid ${active ? "hsl(var(--primary))" : `hsl(${t.vars["--foreground"]} / 0.35)`}`,
              }}>
              <div className="flex gap-1">
                <span className="h-3.5 w-3.5 rounded-full border border-white/50 shadow-sm" style={{ background: t.ring }} />
                <span className="h-3.5 w-3.5 rounded-full border border-white/50 shadow-sm" style={{ background: t.rest }} />
              </div>
              <span className="font-display text-sm font-semibold" style={{ color: nameColor }}>{t.name}</span>
              {active && (
                <span className="absolute right-2 top-2 grid h-4 w-4 place-items-center rounded-full text-white" style={{ background: t.ring }}>
                  <Check size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MusicPanel({ isPremium, gateThen }: any) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [customError, setCustomError] = useState(false);
  const [customTarget, setCustomTarget] = useState<{ type: SpotifyEmbedType; id: string } | null>(null);

  const preset = selectedId ? SPOTIFY_PRESETS.find((p) => p.id === selectedId) ?? null : null;
  const target = customTarget ?? (preset ? { type: preset.type, id: preset.spotifyId } : null);

  const selectPreset = (id: string) => {
    setSelectedId(id);
    setCustomTarget(null);
    setCustomUrl("");
    setCustomError(false);
  };

  const applyCustomUrl = (value: string) => {
    setCustomUrl(value);
    if (!value.trim()) { setCustomError(false); return; }
    const parsed = parseSpotifyUrl(value);
    if (parsed) {
      setSelectedId(null);
      setCustomTarget(parsed);
      setCustomError(false);
    } else {
      setCustomError(true);
    }
  };

  return (
    <div className="relative rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music size={16} className="text-primary" />
          <h2 className="font-display text-lg font-semibold">Music</h2>
        </div>
        {!isPremium && <span className="flex items-center gap-1 text-xs text-primary"><Crown size={12} /> Premium</span>}
      </div>

      <div className={!isPremium ? "blur-sm" : ""}>
        <div className="grid grid-cols-2 gap-2">
          {SPOTIFY_PRESETS.map((p) => {
            const active = !customTarget && selectedId === p.id;
            return (
              <button key={p.id} onClick={() => selectPreset(p.id)}
                className={`relative rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card/60 hover:border-primary/40"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{p.name}</span>
                  {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{p.hint}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <label htmlFor="spotify-url" className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Or paste a Spotify link
          </label>
          <input id="spotify-url" type="text" value={customUrl}
            onChange={(e) => applyCustomUrl(e.target.value)}
            placeholder="https://open.spotify.com/playlist/..."
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
          {customError && (
            <p className="mt-1.5 text-[11px] text-destructive">
              Couldn't read that link — paste a track, playlist, album, artist, episode, or show URL from Spotify.
            </p>
          )}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl">
          {target ? (
            <iframe key={`${target.type}-${target.id}`} src={toEmbedSrc(target)} width="100%" height={embedHeight(target.type)}
              style={{ borderRadius: 12, border: "none" }}
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy" title="Spotify player" />
          ) : (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Pick a preset or paste a link to start playing.
            </p>
          )}
        </div>
      </div>

      {!isPremium && (
        <button onClick={() => gateThen(() => {})} className="absolute inset-0 grid place-items-center rounded-2xl">
          <span className="rounded-full gradient-primary px-5 py-2 text-sm font-semibold text-white shadow-glow">Unlock Spotify music</span>
        </button>
      )}
    </div>
  );
}

const FREE_MONTHLY_UPLOAD_QUOTA = 3;
const ALLOWED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function currentUploadPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1)); // strip the "data:<type>;base64," prefix
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function UploadTasksPanel({ profile, onImported, onUpgrade }: any) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const isPremium = profile?.is_premium ?? false;
  const usedThisPeriod = profile?.ai_uploads_period === currentUploadPeriod() ? (profile?.ai_uploads_count ?? 0) : 0;
  const remaining = Math.max(0, FREE_MONTHLY_UPLOAD_QUOTA - usedThisPeriod);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setQuotaExceeded(false);
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      setError("Unsupported file type — upload a PDF or photo (JPEG/PNG/WebP/GIF).");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That file is too large — try something under 15MB.");
      return;
    }
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) { setError("Sign in to upload study material."); setLoading(false); return; }
      const fileBase64 = await fileToBase64(file);
      const res = await fetch("/api/generate-tasks", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fileBase64, mediaType: file.type }),
      });
      const result = await res.json();
      if (res.status === 403 && result.error === "quota_exceeded") {
        setQuotaExceeded(true);
        return;
      }
      if (!res.ok) {
        setError(result.error ?? "Something went wrong — try again.");
        return;
      }
      onImported(result.tasks);
      setOpen(false);
    } catch {
      setError("Couldn't reach the server. Try again soon.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-left transition hover:border-primary/40">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Sparkles size={16} className="text-primary" /> Upload notes or slides — auto-generate tasks
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {isPremium ? "Unlimited uploads" : `${remaining} of ${FREE_MONTHLY_UPLOAD_QUOTA} free left this month`}
        </span>
      </button>
    );
  }

  if (quotaExceeded) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4">
        <p className="text-sm text-muted-foreground">You've used your {FREE_MONTHLY_UPLOAD_QUOTA} free uploads this month.</p>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={onUpgrade} className="rounded-full gradient-primary px-4 py-1.5 text-xs font-semibold text-white shadow-glow">Go Premium</button>
          <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground underline">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Upload a PDF or photo</span>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
      </div>
      <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
        disabled={loading}
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        className="mt-3 block w-full text-xs text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary" />
      {loading && <p className="mt-2 text-xs text-muted-foreground">Reading your file and generating tasks…</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function TasksView({ tasks, activeTask, setActiveTask, addTask, toggleTask, removeTask, session, onSignIn, profile, addImportedTasks, onSubscribe }: any) {
  const [draft, setDraft] = useState("");
  const [tag, setTag] = useState("Pharm");
  const add = () => {
    if (!draft.trim()) return;
    addTask(draft.trim(), tag);
    setDraft("");
  };
  const tags = ["Pharm", "Cardio", "Clinical", "PANCE", "Anatomy"];

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Tasks</h1>
      <p className="mt-1 text-sm text-muted-foreground">Queue what you'll study. Pick one to focus on.</p>
      {!session && (
        <div className="mt-4">
          <SignInPrompt onSignIn={onSignIn} message="Sign in to save your tasks across devices." />
        </div>
      )}
      {session && (
        <div className="mt-4">
          <UploadTasksPanel profile={profile} onImported={addImportedTasks} onUpgrade={onSubscribe} />
        </div>
      )}
      <div className="mt-6 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a study task…"
          className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <select value={tag} onChange={(e) => setTag(e.target.value)} className="rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
          {tags.map((t) => <option key={t}>{t}</option>)}
        </select>
        <button onClick={add} className="grid w-12 place-items-center rounded-xl gradient-primary text-white shadow-glow transition active:scale-95"><Plus size={20} /></button>
      </div>
      <div className="mt-6 space-y-2">
        {tasks.map((t: Task) => (
          <div key={t.id} className={`group flex items-center gap-3 rounded-xl border p-3 transition ${activeTask === t.id ? "border-primary bg-primary/5" : "border-border bg-card/70"}`}>
            <button onClick={() => toggleTask(t.id)} className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border transition ${t.done ? "border-roamly-green bg-roamly-green" : "border-muted-foreground/40 hover:border-primary"}`}>
              {t.done && <Check size={14} className="text-white" />}
            </button>
            <button onClick={() => setActiveTask(t.id)} className="flex flex-1 items-center gap-3 text-left">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-[10px] font-semibold text-primary">{t.tag.slice(0, 2)}</span>
              <span className={`flex-1 text-sm ${t.done ? "text-muted-foreground line-through" : ""}`}>{t.title}</span>
            </button>
            <span className="font-mono text-xs text-muted-foreground">{t.poms}/{t.est}</span>
            <button onClick={() => removeTask(t.id)} className="text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"><X size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyGoalCard({ streak, todayMinutes, dailyGoal, setDailyGoal }: any) {
  const pct = Math.min(100, Math.round((todayMinutes / dailyGoal) * 100));
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Your progress</h2>
        {streak > 0 && (
          <span className="flex items-center gap-1 text-xs text-primary"><Flame size={13} /> {streak}-day streak</span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Today</span>
        <span className="font-mono">{todayMinutes} / {dailyGoal} min</span>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%`, transition: "width 0.4s ease" }} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">Daily goal</span>
        <NumberField value={dailyGoal} unit="min" min={5} max={600} label="Daily goal" onChange={setDailyGoal} />
      </div>
    </div>
  );
}

function AnalyticsView({ isPremium, onUpsell, streak, todayMinutes, dailyGoal, setDailyGoal, session, onSignIn }: any) {
  const totalMin = WEEK_DATA.reduce((a, b) => a + b.min, 0);
  const totalSessions = WEEK_DATA.reduce((a, b) => a + b.sessions, 0);
  const best = WEEK_DATA.reduce((a, b) => (b.min > a.min ? b : a));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-3xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your last 7 days of focus.</p>

      <div className="mt-6">
        {session ? (
          <DailyGoalCard streak={streak} todayMinutes={todayMinutes} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal} />
        ) : (
          <SignInPrompt onSignIn={onSignIn} message="Sign in to track your streak and daily goal." />
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Focus time" value={`${Math.floor(totalMin / 60)}h ${totalMin % 60}m`} />
        <Stat label="Sessions" value={String(totalSessions)} />
        <Stat label="Best day" value={best.day} sub={`${best.min}m`} />
      </div>
      <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold">Focus minutes by day</h2>
        <p className="mb-4 text-xs text-muted-foreground">Demo data — a sample week for illustration.</p>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={WEEK_DATA}>
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <Tooltip cursor={{ fill: "hsl(var(--primary) / 0.08)" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--card-foreground))" }} />
              <Bar dataKey="min" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="relative mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Subject breakdown</h2>
          {!isPremium && <span className="flex items-center gap-1 text-xs text-primary"><Crown size={12} /> Premium</span>}
        </div>
        <div className={`mt-2 flex items-center gap-6 ${!isPremium ? "blur-sm" : ""}`}>
          <div className="h-40 w-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={SUBJECT_SPLIT} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {SUBJECT_SPLIT.map((s) => <Cell key={s.name} fill={s.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {SUBJECT_SPLIT.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-sm">
                <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />
                <span className="w-20">{s.name}</span>
                <span className="font-mono text-muted-foreground">{s.value}%</span>
              </div>
            ))}
          </div>
        </div>
        {!isPremium && (
          <button onClick={onUpsell} className="absolute inset-0 grid place-items-center">
            <span className="rounded-full gradient-primary px-5 py-2 text-sm font-semibold text-white shadow-glow">Unlock full analytics</span>
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-primary">{sub}</div>}
    </div>
  );
}

function RoomsView({ isPremium, gateThen }: any) {
  const [joined, setJoined] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Study rooms</h1>
          <p className="mt-1 text-sm text-muted-foreground">Focus alongside other PA students in real time.</p>
        </div>
        <button onClick={() => gateThen(() => {})} className="flex items-center gap-1.5 rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-white shadow-glow transition active:scale-95">
          <Plus size={16} /> Host
        </button>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {ROOMS.map((r) => {
          const full = r.members >= r.cap;
          const isJoined = joined === r.id;
          return (
            <div key={r.id} className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{r.name}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.focus} · hosted by {r.host}</p>
                </div>
                <span className="mt-1.5 h-2 w-2 animate-pulse rounded-full bg-roamly-green" />
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users size={13} /> {r.members}/{r.cap}
                </div>
                <button onClick={() => setJoined(isJoined ? null : r.id)} disabled={full && !isJoined}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${isJoined ? "border border-roamly-green bg-roamly-green/10 text-roamly-green" : full ? "cursor-not-allowed border border-border bg-secondary text-muted-foreground" : "gradient-primary text-white shadow-glow active:scale-95"}`}>
                  {isJoined ? "Leave" : full ? "Full" : "Join"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {!isPremium && (
        <p className="mt-5 text-center text-xs text-muted-foreground">Free plan: join up to 3 sessions a day. <span className="text-primary">Premium</span> removes all limits.</p>
      )}
    </div>
  );
}

function PremiumView({ isPremium, session, onSubscribe, checkoutLoading, checkoutError }: any) {
  const perks = ["Ambient study themes", "Unlimited analytics history", "Unlimited hosted sessions", "Unlimited room joins", "Premium UI themes", "PANCE & Marathon methods", "Spotify music embed"];
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">{isPremium ? "Your Premium" : "Go Premium"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Built for the long road to the PANCE.</p>
      {!isPremium && (
        <div className="mt-6 overflow-hidden rounded-3xl gradient-accent p-px shadow-glow">
          <div className="rounded-3xl bg-card/95 p-7 backdrop-blur">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold">$6</span>
              <span className="text-muted-foreground">/ month</span>
            </div>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {perks.map((p) => (
                <div key={p} className="flex items-center gap-2 text-sm">
                  <Check size={16} className="shrink-0 text-roamly-green" /> {p}
                </div>
              ))}
            </div>
            <button onClick={onSubscribe} disabled={checkoutLoading}
              className="mt-6 w-full rounded-full gradient-primary py-3 font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">
              {session ? (checkoutLoading ? "Redirecting…" : "Subscribe with Stripe") : "Sign in to subscribe"}
            </button>
            {checkoutError && <p className="mt-2 text-center text-xs text-destructive">{checkoutError}</p>}
            <p className="mt-2 text-center text-xs text-muted-foreground">Billed monthly via Stripe. Cancel anytime.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Upsell({ onClose, onUpgrade }: { onClose: () => void; onUpgrade: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="grid h-12 w-12 place-items-center rounded-2xl gradient-primary shadow-glow"><Crown className="text-white" /></div>
        <h3 className="mt-4 font-display text-xl font-semibold">This is a Premium feature</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">Unlock premium methods, themes, full analytics, and unlimited study rooms.</p>
        <button onClick={onUpgrade} className="mt-5 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95">Try Premium free</button>
        <button onClick={onClose} className="mt-2 w-full rounded-full py-2 text-sm text-muted-foreground">Maybe later</button>
      </div>
    </div>
  );
}

function BottomNav({ nav, view, setView }: any) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
        {nav.map((n: any) => {
          const Icon = n.icon;
          const active = view === n.id;
          return (
            <button key={n.id} onClick={() => setView(n.id)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon size={20} strokeWidth={active ? 2.4 : 2} />
              <span className="text-[10px] font-medium">{n.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
