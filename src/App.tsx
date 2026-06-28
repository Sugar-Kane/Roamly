import { useEffect, useMemo, useRef, useState } from "react";
import { Timer, ListChecks, BarChart3, Users, Sparkles, Check, Plus, Minus, Crown, Play, Pause, RotateCcw, SkipForward, X, Music, Volume2, Volume1, VolumeX, Palette } from "lucide-react";
import { METHODS, SEED_TASKS, WEEK_DATA, SUBJECT_SPLIT, THEMES, ROOMS, type Task } from "./data";
import { useTimer, fmt } from "./useTimer";
import { useSoundscape, SOUNDS, CATEGORIES } from "./useSoundscape";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, PieChart, Pie, Cell } from "recharts";

type View = "focus" | "tasks" | "analytics" | "rooms" | "premium";

export default function App() {
  const [view, setView] = useState<View>("focus");
  const [methodId, setMethodId] = useState("classic");
  const [themeId, setThemeId] = useState("coffee");
  const [tasks, setTasks] = useState<Task[]>(SEED_TASKS);
  const [activeTask, setActiveTask] = useState<string | null>("t1");
  const [isPremium, setIsPremium] = useState(false);
  const [showUpsell, setShowUpsell] = useState(false);
  // User-editable values for the Custom method (minutes).
  const [custom, setCustom] = useState({ focus: 30, short: 7, long: 20, cycles: 4 });

  const method = useMemo(() => {
    const base = METHODS.find((m) => m.id === methodId)!;
    return base.id === "custom" ? { ...base, ...custom } : base;
  }, [methodId, custom]);
  const theme = useMemo(() => THEMES.find((t) => t.id === themeId)!, [themeId]);
  const timer = useTimer(method);
  const sound = useSoundscape();

  const nav: { id: View; label: string; icon: typeof Timer }[] = [
    { id: "focus", label: "Focus", icon: Timer },
    { id: "tasks", label: "Tasks", icon: ListChecks },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "rooms", label: "Rooms", icon: Users },
    { id: "premium", label: "Premium", icon: Sparkles },
  ];

  const gateThen = (fn: () => void) => (isPremium ? fn() : setShowUpsell(true));

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
        <Header isPremium={isPremium} />
        <ThemePicker themeId={themeId} setThemeId={setThemeId} />
        <main className="mt-8 flex-1">
          {view === "focus" && (
            <FocusView method={method} methodId={methodId} setMethodId={setMethodId} timer={timer} theme={theme}
              tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask}
              custom={custom} setCustom={setCustom}
              isPremium={isPremium} gateThen={gateThen} sound={sound} />
          )}
          {view === "tasks" && <TasksView tasks={tasks} setTasks={setTasks} activeTask={activeTask} setActiveTask={setActiveTask} />}
          {view === "analytics" && <AnalyticsView isPremium={isPremium} onUpsell={() => setShowUpsell(true)} />}
          {view === "rooms" && <RoomsView isPremium={isPremium} gateThen={gateThen} />}
          {view === "premium" && <PremiumView isPremium={isPremium} setIsPremium={setIsPremium} />}
        </main>
      </div>
      <BottomNav nav={nav} view={view} setView={setView} />
      {showUpsell && <Upsell onClose={() => setShowUpsell(false)} onUpgrade={() => { setIsPremium(true); setShowUpsell(false); }} />}
    </div>
  );
}

function Header({ isPremium }: any) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-2xl font-semibold tracking-tight text-gradient">Roamly</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">Focus</span>
      </div>
      <div className="flex items-center gap-3">
        {isPremium && (
          <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Crown size={13} /> Premium
          </span>
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

function FocusView({ method, methodId, setMethodId, timer, theme, tasks, activeTask, setActiveTask, custom, setCustom, isPremium, gateThen, sound }: any) {
  const phaseLabel = timer.phase === "focus" ? "Focus" : timer.phase === "short" ? "Short break" : "Long break";
  const task = tasks.find((t: Task) => t.id === activeTask);
  const ring = timer.phase === "focus" ? theme.ring : theme.rest;
  const timerRef = useRef<HTMLElement>(null);
  const scrollToTimer = () => timerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="space-y-8">
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
          <SoundPanel sound={sound} />
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

function SoundPanel({ sound }: any) {
  const VolIcon = sound.volume === 0 ? VolumeX : sound.volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music size={16} className="text-primary" />
          <h2 className="font-display text-lg font-semibold">Sound</h2>
        </div>
        {sound.activeId !== "off" && (
          <button onClick={() => sound.play("off")} className="text-xs font-medium text-muted-foreground transition hover:text-foreground">
            Stop
          </button>
        )}
      </div>

      <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
        {CATEGORIES.map((cat: string) => (
          <div key={cat}>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{cat}</p>
            <div className="grid grid-cols-2 gap-2">
              {SOUNDS.filter((s: any) => s.category === cat && s.id !== "off").map((s: any) => {
                const active = sound.activeId === s.id;
                return (
                  <button key={s.id} onClick={() => sound.play(s.id)}
                    className={`relative rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card/60 hover:border-primary/40"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{s.name}</span>
                      {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.hint}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <VolIcon size={16} className="shrink-0 text-muted-foreground" />
        <input type="range" min={0} max={1} step={0.01} value={sound.volume}
          onChange={(e) => sound.changeVolume(parseFloat(e.target.value))}
          aria-label="Volume"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary" />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{SOUNDS.length - 1} sounds, all free — generated live, plays offline.</p>
    </div>
  );
}

function TasksView({ tasks, setTasks, activeTask, setActiveTask }: any) {
  const [draft, setDraft] = useState("");
  const [tag, setTag] = useState("Pharm");
  const add = () => {
    if (!draft.trim()) return;
    setTasks([{ id: crypto.randomUUID(), title: draft.trim(), tag, done: false, poms: 0, est: 2 }, ...tasks]);
    setDraft("");
  };
  const toggle = (id: string) => setTasks(tasks.map((t: Task) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => setTasks(tasks.filter((t: Task) => t.id !== id));
  const tags = ["Pharm", "Cardio", "Clinical", "PANCE", "Anatomy"];

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Tasks</h1>
      <p className="mt-1 text-sm text-muted-foreground">Queue what you'll study. Pick one to focus on.</p>
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
            <button onClick={() => toggle(t.id)} className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border transition ${t.done ? "border-roamly-green bg-roamly-green" : "border-muted-foreground/40 hover:border-primary"}`}>
              {t.done && <Check size={14} className="text-white" />}
            </button>
            <button onClick={() => setActiveTask(t.id)} className="flex flex-1 items-center gap-3 text-left">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-[10px] font-semibold text-primary">{t.tag.slice(0, 2)}</span>
              <span className={`flex-1 text-sm ${t.done ? "text-muted-foreground line-through" : ""}`}>{t.title}</span>
            </button>
            <span className="font-mono text-xs text-muted-foreground">{t.poms}/{t.est}</span>
            <button onClick={() => remove(t.id)} className="text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"><X size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsView({ isPremium, onUpsell }: any) {
  const totalMin = WEEK_DATA.reduce((a, b) => a + b.min, 0);
  const totalSessions = WEEK_DATA.reduce((a, b) => a + b.sessions, 0);
  const best = WEEK_DATA.reduce((a, b) => (b.min > a.min ? b : a));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-3xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your last 7 days of focus.</p>
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Focus time" value={`${Math.floor(totalMin / 60)}h ${totalMin % 60}m`} />
        <Stat label="Sessions" value={String(totalSessions)} />
        <Stat label="Best day" value={best.day} sub={`${best.min}m`} />
      </div>
      <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold">Focus minutes by day</h2>
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

function PremiumView({ isPremium, setIsPremium }: any) {
  const perks = ["Ambient study themes", "Unlimited analytics history", "Unlimited hosted sessions", "Unlimited room joins", "Premium UI themes", "PANCE & Marathon methods"];
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
            <button onClick={() => setIsPremium(true)} className="mt-6 w-full rounded-full gradient-primary py-3 font-semibold text-white shadow-glow transition active:scale-95">
              Start free trial
            </button>
            <p className="mt-2 text-center text-xs text-muted-foreground">7 days free, then $6/mo. Billing handled by Stripe once connected.</p>
          </div>
        </div>
      )}
      {isPremium && (
        <button onClick={() => setIsPremium(false)} className="mt-8 text-xs text-muted-foreground underline">Switch back to free (demo)</button>
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
