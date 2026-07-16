import { lazy, Suspense } from "react";
import { Crown } from "lucide-react";
import { tagColor, type Task } from "../data";
import { dateKey, type FocusSession } from "../streaks";
import { StudyInsights } from "../StudyInsights";
import { Stat, PremiumAnalyticsGate, SignInPrompt } from "../commonUi";
import { DailyGoalCard } from "./TasksView";
import type { PlannedStudySession, StudyEvent } from "../release3";
import type { Session } from "@supabase/supabase-js";

const WeekChart = lazy(() => import("../Charts").then((m) => ({ default: m.WeekChart })));
const SubjectDonut = lazy(() => import("../Charts").then((m) => ({ default: m.SubjectDonut })));

export function AnalyticsView({ isPremium, onUpsell, streak, todayMinutes, dailyGoal, setDailyGoal, session, onSignIn, sessions, tasks, studyEvents, plannedSessions }: {
  isPremium: boolean;
  onUpsell: () => void;
  streak: number;
  todayMinutes: number;
  dailyGoal: number;
  setDailyGoal: (minutes: number) => void;
  session: Session | null;
  onSignIn: () => void;
  sessions: FocusSession[];
  tasks: Task[];
  studyEvents: StudyEvent[];
  plannedSessions: PlannedStudySession[];
}) {
  // All numbers below come from the user's real focus_sessions rows
  // days, one row per day) and their real tasks — nothing is mocked.
  const byDate = new Map<string, number>((sessions as FocusSession[]).map((s) => [s.date, s.minutes]));
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = dateKey(d);
    return { day: i === 6 ? "Today" : DAY[d.getDay()], min: byDate.get(key) ?? 0 };
  });
  const weekMin = week.reduce((a, b) => a + b.min, 0);
  const bestWeek = week.reduce((a, b) => (b.min > a.min ? b : a));
  const totalMin60 = (sessions as FocusSession[]).reduce((a, s) => a + s.minutes, 0);
  const activeDays = (sessions as FocusSession[]).filter((s) => s.minutes > 0).length;
  const bestDayEver = (sessions as FocusSession[]).reduce((m, s) => Math.max(m, s.minutes), 0);

  // Subject split from real completed pomodoros per subject.
  const pomsByTag = new Map<string, number>();
  for (const t of tasks as Task[]) if (t.poms > 0) pomsByTag.set(t.tag, (pomsByTag.get(t.tag) ?? 0) + t.poms);
  const pomsTotal = [...pomsByTag.values()].reduce((a, b) => a + b, 0);
  const subjectSplit = [...pomsByTag.entries()]
    .map(([name, poms]) => ({ name, value: Math.round((poms / Math.max(1, pomsTotal)) * 100), color: tagColor(name) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const hrs = Math.floor(totalMin60 / 60);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-3xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">Live from your timer. Every session you finish counts here.</p>

      <div className="mt-6">
        {session ? (
          <DailyGoalCard streak={streak} todayMinutes={todayMinutes} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal} />
        ) : (
          <><DailyGoalCard streak={streak} todayMinutes={todayMinutes} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal} /><div className="mt-3"><SignInPrompt onSignIn={onSignIn} message="As a guest, analytics track only what you do in this browser, on this device. Nothing is saved to an account. Create a free account to keep your history, streaks, and stats everywhere you sign in." /></div></>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="This week" value={`${Math.floor(weekMin / 60)}h ${weekMin % 60}m`} />
        <Stat label="Streak" value={`${streak} day${streak === 1 ? "" : "s"}`} />
        <Stat label="Best day (7d)" value={bestWeek.min > 0 ? bestWeek.day : "-"} sub={bestWeek.min > 0 ? `${bestWeek.min}m` : "No focus yet"} />
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold">Focus minutes by day</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          {weekMin > 0 ? "Your last 7 days." : "Finish a focus session and it shows up here."}
        </p>
        <div className="h-52">
          <Suspense fallback={<div className="h-full w-full animate-pulse rounded-xl bg-border/40" />}>
            <WeekChart week={week} />
          </Suspense>
        </div>
      </div>

      {isPremium ? (
        <StudyInsights events={studyEvents} daily={sessions} plans={plannedSessions} />
      ) : (
        <div className="mt-6 space-y-6">
          <PremiumAnalyticsGate title="Study breakdown" description="Unlock task, category, and study-trend analysis across every time range." onUpgrade={onUpsell} />
          <PremiumAnalyticsGate title="Study post-mortem" description="Unlock follow-through patterns, missed-session reasons, and practical planning guidance." onUpgrade={onUpsell} />
        </div>
      )}

      {isPremium ? subjectSplit.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Subject breakdown</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Share of your completed pomodoros by subject.</p>
          <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
            <div className="h-40 w-40">
              <Suspense fallback={<div className="h-full w-full animate-pulse rounded-full bg-border/40" />}>
                <SubjectDonut subjectSplit={subjectSplit} />
              </Suspense>
            </div>
            <div className="space-y-2">
              {subjectSplit.map((s) => (
                <div key={s.name} className="flex items-center gap-2 text-sm">
                  <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />
                  <span className="w-24 truncate">{s.name}</span>
                  <span className="font-mono text-muted-foreground">{s.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : <PremiumAnalyticsGate title="Subject breakdown" description="Unlock a visual breakdown of completed focus sessions by subject." onUpgrade={onUpsell} />}

      <div className="relative mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Study history</h2>
          {!isPremium && <span className="flex items-center gap-1 text-xs text-primary"><Crown size={12} /> Premium</span>}
        </div>
        {/* Free users get placeholder digits, not real values behind a blur —
            a CSS-only gate leaves the numbers readable in the DOM. */}
        <div className={`mt-2 grid grid-cols-3 gap-3 ${!isPremium ? "blur-sm" : ""}`}>
          <Stat label="Total focus" value={isPremium ? `${hrs}h ${totalMin60 % 60}m` : "‒‒h ‒‒m"} />
          <Stat label="Active days" value={isPremium ? String(activeDays) : "‒‒"} />
          <Stat label="Best day ever" value={isPremium ? `${bestDayEver}m` : "‒‒m"} />
        </div>
        {!isPremium && (
          <button onClick={onUpsell} className="absolute inset-0 grid place-items-center">
            <span className="rounded-full gradient-primary px-5 py-2 text-sm font-semibold text-white shadow-glow">Unlock full history</span>
          </button>
        )}
      </div>
    </div>
  );
}
