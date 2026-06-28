import { useMemo, useState } from "react";
import { Timer, ListChecks, BarChart3, Users, Sparkles, Check, Plus, Crown, Play, Pause, RotateCcw, SkipForward, X, Music, Volume2, Volume1, VolumeX } from "lucide-react";
import { METHODS, SEED_TASKS, WEEK_DATA, SUBJECT_SPLIT, THEMES, ROOMS, type Task } from "./data";
import { useTimer, fmt } from "./useTimer";
import { useSoundscape, SOUNDS } from "./useSoundscape";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, PieChart, Pie, Cell } from "recharts";

type View = "focus" | "tasks" | "analytics" | "rooms" | "premium";

export default function App() {
  const [view, setView] = useState<View>("focus");
  const [methodId, setMethodId] = useState("classic");
  const [themeId, setThemeId] = useState("lamp");
  const [tasks, setTasks] = useState<Task[]>(SEED_TASKS);
  const [activeTask, setActiveTask] = useState<string | null>("t1");
  const [isPremium, setIsPremium] = useState(false);
  const [showUpsell, setShowUpsell] = useState(false);

  const method = useMemo(() => METHODS.find((m) => m.id === methodId)!, [methodId]);
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

  return (
    <div className="min-h-screen text-foreground font-sans" style={{ background: `linear-gradient(160% 120% at 50% -10%, ${theme.from} 0%, ${theme.to} 70%)` }}>
      <div className="relative mx-auto flex max-w-6xl flex-col px-5 pb-28 pt-7 md:px-8">
        <Header isPremium={isPremium} />
        <main className="mt-8 flex-1">
          {view === "focus" && (
            <FocusView method={method} methodId={methodId} setMethodId={setMethodId} timer={timer}
              tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask}
              isPremium={isPremium} gateThen={gateThen} sound={sound} />
          )}
          {view === "tasks" && <TasksView tasks={tasks} setTasks={setTasks} activeTask={activeTask} setActiveTask={setActiveTask} />}
          {view === "analytics" && <AnalyticsView isPremium={isPremium} onUpsell={() => setShowUpsell(true)} />}
          {view === "rooms" && <RoomsView isPremium={isPremium} gateThen={gateThen} />}
          {view === "premium" && <PremiumView isPremium={isPremium} setIsPremium={setIsPremium} themeId={themeId} setThemeId={setThemeId} gateThen={gateThen} />}
        </main>
      </div>
      <BottomNav nav={nav} view={view} setView={setView} />
      {showUpsell && <Upsell onClose={() => setShowUpsell(false)} onUpgrade={() => { setIsPremium(true); setShowUpsell(false); }} />}
    </div>
  );
}

function Header({ isPremium }: { isPremium: boolean }) {
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

function FocusView({ method, methodId, setMethodId, timer, tasks, activeTask, setActiveTask, isPremium, gateThen, sound }: any) {
  const phaseLabel = timer.phase === "focus" ? "Focus" : timer.phase === "short" ? "Short break" : "Long break";
  const task = tasks.find((t: Task) => t.id === activeTask);
  const ring = timer.phase === "focus" ? "#7C5CFA" : "#16A34A";

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="flex flex-col items-center justify-center rounded-3xl border border-border bg-card/80 p-8 shadow-sm backdrop-blur">
        <span className="mb-1 font-mono text-xs uppercase tracking-[0.25em]" style={{ color: ring }}>{phaseLabel}</span>
        <span className="mb-6 text-sm text-muted-foreground">{method.name}</span>
        <div className="relative grid place-items-center">
          <svg width="280" height="280" viewBox="0 0 280 280" className="rotate-[-90deg]">
            <circle cx="140" cy="140" r="128" fill="none" stroke="hsl(220 13% 91%)" strokeWidth="6" />
            <circle cx="140" cy="140" r="128" fill="none" stroke={ring} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 128}
              strokeDashoffset={2 * Math.PI * 128 * (1 - timer.progress)}
              style={{ transition: "stroke-dashoffset 1s linear" }} />
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="font-display text-6xl font-medium tabular-nums tracking-tight">{fmt(timer.secondsLeft)}</span>
            <div className="mt-3 flex gap-1.5">
              {Array.from({ length: method.cycles }).map((_, i) => (
                <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: i < timer.completedFocus % method.cycles ? ring : "hsl(220 13% 88%)" }} />
              ))}
            </div>
          </div>
        </div>
        {task && (
          <div className="mt-6 max-w-xs text-center">
            <span className="text-xs text-muted-foreground">Working on</span>
            <p className="mt-0.5 text-sm font-medium text-foreground">{task.title}</p>
          </div>
        )}
        <div className="mt-7 flex items-center gap-3">
          <button onClick={timer.reset} className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground" aria-label="Reset">
            <RotateCcw size={17} />
          </button>
          <button onClick={timer.running ? timer.pause : timer.start}
            className="flex h-16 w-16 items-center justify-center rounded-full font-semibold text-white shadow-glow transition active:scale-95"
            style={{ background: ring }} aria-label={timer.running ? "Pause" : "Start"}>
            {timer.running ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}
          </button>
          <button onClick={timer.skip} className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground" aria-label="Skip">
            <SkipForward size={17} />
          </button>
        </div>
      </section>

      <section className="space-y-6">
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
        <SoundPanel sound={sound} isPremium={isPremium} gateThen={gateThen} />
      </section>
    </div>
  );
}

function SoundPanel({ sound, isPremium, gateThen }: any) {
  const VolIcon = sound.volume === 0 ? VolumeX : sound.volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Music size={16} className="text-primary" />
        <h2 className="font-display text-lg font-semibold">Sound</h2>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SOUNDS.map((s: any) => {
          const locked = s.premium && !isPremium;
          const active = sound.activeId === s.id;
          return (
            <button key={s.id} onClick={() => (locked ? gateThen(() => sound.play(s.id)) : sound.play(s.id))}
              className={`relative rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card/60 hover:border-primary/40"}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{s.name}</span>
                {locked ? <Crown size={12} className="text-primary" /> : active && s.id !== "off" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> : null}
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.hint}</p>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <VolIcon size={16} className="shrink-0 text-muted-foreground" />
        <input type="range" min={0} max={1} step={0.01} value={sound.volume}
          onChange={(e) => sound.changeVolume(parseFloat(e.target.value))}
          aria-label="Volume"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary" />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Sounds are generated live — no downloads, plays offline.</p>
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
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "hsl(220 9% 46%)", fontSize: 12 }} />
              <Tooltip cursor={{ fill: "rgba(124,92,250,0.08)" }} contentStyle={{ background: "#fff", border: "1px solid hsl(220 13% 91%)", borderRadius: 12, color: "hsl(220 13% 18%)" }} />
              <Bar dataKey="min" radius={[6, 6, 0, 0]} fill="#7C5CFA" />
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

function PremiumView({ isPremium, setIsPremium, themeId, setThemeId, gateThen }: any) {
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
      <div className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold">Study themes</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {THEMES.map((t) => {
            const locked = t.premium && !isPremium;
            return (
              <button key={t.id} onClick={() => (locked ? gateThen(() => setThemeId(t.id)) : setThemeId(t.id))}
                className={`relative h-28 overflow-hidden rounded-2xl border transition ${themeId === t.id ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"}`}
                style={{ background: `linear-gradient(135deg, ${t.from}, ${t.to})` }}>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-3">
                  <span className="text-sm font-medium text-foreground">{t.name}</span>
                  {locked && <Crown size={13} className="text-primary" />}
                </div>
                {themeId === t.id && <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full gradient-primary text-white"><Check size={12} /></span>}
              </button>
            );
          })}
        </div>
      </div>
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
