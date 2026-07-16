import { useEffect, useRef, useState } from "react";
import { Timer, ChevronDown, Play, Pause, RotateCcw, SkipForward, Crown, X, Plus, PictureInPicture2, PawPrint, Moon, PartyPopper, Check } from "lucide-react";
import { METHODS, sortTasks, type Task, type Method, type Theme } from "../data";
import { fmt } from "../useTimer";
import type { useTimer } from "../useTimer";
import type { useCountUpTimer } from "../useCountUpTimer";
import type { useEndOfPhaseAlerts } from "../useEndOfPhaseAlerts";
import { unlockAudio } from "../focusSounds";
import { loadPref, savePref } from "../storage";
import { TimeDisplay, InfoTip } from "../FocusMode";
import { MotivationLine } from "../useFocusMotivation";
import { Modal } from "../Modal";
import { HealthyBreakActivities, useBreakActivityPicks, type Activity } from "../HealthyBreakActivities";
import { AdBreakPrompt } from "../AdBreak";
import { PomodoroExplainer, SignInPrompt, NotificationToggle, CustomEditor } from "../commonUi";
import { ExamSchedulePanel } from "../examSchedule";
import { TagPill } from "../taskModals";
import { FocusSoundsPanel, MusicPanel } from "../musicControls";
import type { ExamSchedule } from "../db";
import type { EmbedTarget, SoundsController, CustomMethod } from "../appTypes";
import type { Session } from "@supabase/supabase-js";
import type { ReactNode } from "react";

export function FocusView({ method, methodId, setMethodId, timer, theme, tasks, activeTask, setActiveTask, custom, setCustom, isPremium, gateThen, exams, addExam, editExam, removeExam, alerts, session, onSignIn, sounds, enterFocus, pipSupported, pipActive, onPopOut, onClosePip, embed, shownEmbed, playEmbed, embedStopSignal, onEmbedPlaying, runSolo, autoFlow, onToggleAutoFlow, onOpenTasks, onAdvertise, onGoPremium, countUp, onCompleteCountUp, companions, showCompanions, petsAsleep, onToggleSleep, companionsOn, onToggleCompanions, confettiOn, onToggleConfetti, dockClosed, onReopenDock, motivation }: {
  method: Method;
  methodId: string;
  setMethodId: (id: string) => void;
  timer: ReturnType<typeof useTimer>;
  theme: Theme;
  tasks: Task[];
  activeTask: string | null;
  setActiveTask: (id: string | null) => void;
  custom: CustomMethod;
  setCustom: (next: CustomMethod) => void;
  isPremium: boolean;
  gateThen: (fn: () => void) => void;
  exams: ExamSchedule[];
  addExam: (name: string, date: string) => Promise<boolean>;
  editExam: (id: string, name: string, date: string) => Promise<boolean>;
  removeExam: (id: string) => Promise<boolean>;
  alerts: ReturnType<typeof useEndOfPhaseAlerts>;
  session: Session | null;
  onSignIn: () => void;
  sounds: SoundsController;
  enterFocus: () => void;
  pipSupported: boolean;
  pipActive: boolean;
  onPopOut: () => void;
  onClosePip: () => void;
  embed: EmbedTarget | null;
  shownEmbed: EmbedTarget;
  playEmbed: (target: EmbedTarget) => void;
  embedStopSignal: number;
  onEmbedPlaying: () => void;
  runSolo: (action: () => void) => void;
  autoFlow: boolean;
  onToggleAutoFlow: () => void;
  onOpenTasks: () => void;
  onAdvertise: () => void;
  onGoPremium: () => void;
  countUp: ReturnType<typeof useCountUpTimer>;
  onCompleteCountUp: () => void;
  companions: ReactNode;
  showCompanions: boolean;
  petsAsleep: boolean;
  onToggleSleep: () => void;
  companionsOn: boolean;
  onToggleCompanions: () => void;
  confettiOn: boolean;
  onToggleConfetti: () => void;
  dockClosed: boolean;
  onReopenDock: () => void;
  motivation: string | null;
}) {
  const phaseLabel = timer.phase === "focus" ? "Focus" : timer.phase === "short" ? "Short break" : "Long break";
  const task = tasks.find((t: Task) => t.id === activeTask);
  const ring = timer.phase === "focus" ? theme.ring : theme.rest;
  const timerRef = useRef<HTMLElement>(null);
  const scrollToTimer = () => timerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const [showMethods, setShowMethods] = useState(false);
  // One timer card, two modes: the classic countdown methods or the count-up
  // stopwatch, both picked from the same "Select timer" list.
  const [timerMode, setTimerModeState] = useState<"pomodoro" | "countup">(() => (loadPref("roamly-timer-mode") === "countup" ? "countup" : "pomodoro"));
  const setTimerMode = (m: "pomodoro" | "countup") => { setTimerModeState(m); savePref("roamly-timer-mode", m); };
  // "Up next" can be narrowed to one subject; the pick sticks across visits.
  const [upNextTag, setUpNextTagState] = useState<string>(() => loadPref("roamly-upnext-tag") ?? "all");
  const setUpNextTag = (t: string) => { setUpNextTagState(t); savePref("roamly-upnext-tag", t); };
  const upNextTags: string[] = [...new Set<string>(tasks.filter((t: Task) => !t.done).map((t: Task) => t.tag))];
  const activeUpNextTag = upNextTag !== "all" && !upNextTags.includes(upNextTag) ? "all" : upNextTag;

  return (
    <div className="space-y-8">
      <PomodoroExplainer />

      {session ? (
        <ExamSchedulePanel exams={exams} onCreate={addExam} onUpdate={editExam} onDelete={removeExam} />
      ) : (
        <SignInPrompt onSignIn={onSignIn} message="Sign in to track countdowns for all of your exams." />
      )}

      <section ref={timerRef} data-tour="timer" className="overflow-hidden rounded-3xl border border-border bg-card/80 p-6 shadow-sm backdrop-blur sm:p-8">
        <button onClick={() => setShowMethods(true)}
          className="mb-5 flex w-full items-center justify-between rounded-2xl border border-primary bg-primary/10 px-4 py-2.5 text-sm text-primary transition hover:bg-primary/15">
          <span className="flex items-center gap-2 font-medium"><Timer size={15} className="text-primary" /> Select timer</span>
          <span className="flex items-center gap-1">{timerMode === "countup" ? "Count-up" : method.name} <ChevronDown size={14} /></span>
        </button>
        {timerMode === "pomodoro" ? (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
          <div className="flex shrink-0 flex-col items-center lg:items-start">
            {/* Companions live in their own card (not floating over the Select
                timer button) so pets/plants/accessories never overlap other UI. */}
            {companions && (
              <div className="mb-4 w-full rounded-2xl border border-border bg-card/70 px-3 pb-1 pt-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Companions</span>
                <div className="pointer-events-none h-16 w-full">{companions}</div>
              </div>
            )}
            <span className="font-mono text-xs uppercase tracking-[0.25em]" style={{ color: ring }}>{phaseLabel}</span>
            <TimeDisplay value={fmt(timer.secondsLeft)} className="font-display text-7xl font-medium tracking-tight sm:text-8xl" />
            <span className="mt-1 text-sm text-muted-foreground">{method.name}</span>
            {timer.phase === "focus" && <MotivationLine text={motivation} className="lg:mx-0 lg:text-left" />}
          </div>

          <div className="flex flex-1 flex-col gap-5">
            <div>
              <div className="h-3 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}
                role="progressbar" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={Math.round(Math.max(0, Math.min(1, timer.progress)) * 100)}
                aria-label={`${phaseLabel} progress`}>
                <div className="h-full rounded-full" style={{ width: `${timer.progress * 100}%`, background: ring, transition: "width 1s linear" }} />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex shrink-0 gap-1.5">
                  {Array.from({ length: method.cycles }).map((_, i) => (
                    <span key={i} className="h-1.5 w-6 rounded-full" style={{ background: i < timer.completedFocus % method.cycles ? ring : "hsl(var(--border))" }} />
                  ))}
                </div>
                {task && (
                  <span className="min-w-0 truncate pl-3 text-sm text-muted-foreground">
                    <span className="text-foreground">{task.title}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  // Unlock audio inside the tap itself: iOS refuses to start
                  // sound from the effect that fires after this handler. runSolo
                  // runs its action immediately unless a room needs leaving.
                  if (timer.running) { timer.pause(); return; }
                  runSolo?.(() => { countUp.reset(); unlockAudio(); enterFocus?.(); timer.start(); }); // Start also drops into focus mode
                }}
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
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => enterFocus?.()}
                className="flex items-center gap-1.5 self-start rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/15">
                <Timer size={13} /> Focus mode
              </button>
              <InfoTip text="Focus mode fills your whole screen with the timer, your music, and your task list. Start opens it automatically, and this button gets you back in." />
              {pipSupported && (
                <>
                  <button onClick={() => (pipActive ? onClosePip?.() : onPopOut?.())}
                    className={`flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition ${pipActive ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                    aria-pressed={pipActive}>
                    <PictureInPicture2 size={13} /> {pipActive ? "Close pop-out" : "Pop out timer"}
                  </button>
                  <InfoTip text="Pop the timer into a small floating window that stays on top of other apps, so you can keep studying on the rest of your screen and still see the countdown. Desktop Chrome/Edge only." />
                </>
              )}
              <button onClick={onToggleAutoFlow}
                className={`flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition ${autoFlow ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                aria-pressed={autoFlow}>
                <Play size={13} /> Auto-flow {autoFlow ? "on" : "off"}
              </button>
              <InfoTip text="Auto-flow starts the next phase by itself: focus rolls into break and back without pressing Start. Turn it off to start each block yourself." />
              <NotificationToggle alerts={alerts} />
              {/* Always visible so pets can be turned back on after hiding. */}
              <button onClick={onToggleCompanions} aria-pressed={companionsOn}
                aria-label={companionsOn ? "Hide pets during focus" : "Show pets during focus"}
                className={`flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition ${companionsOn ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
                <PawPrint size={13} /> Pets {companionsOn ? "on" : "off"}
              </button>
              <button onClick={onToggleConfetti} aria-pressed={confettiOn}
                aria-label={confettiOn ? "Turn completion confetti off" : "Turn completion confetti on"}
                className={`flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition ${confettiOn ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
                <PartyPopper size={13} /> Confetti {confettiOn ? "on" : "off"}
              </button>
              {showCompanions && (
                <button onClick={onToggleSleep} aria-pressed={petsAsleep}
                  className={`flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition ${petsAsleep ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
                  <Moon size={13} /> {petsAsleep ? "Wake pets" : "Too distracting"}
                </button>
              )}
            </div>
          </div>
        </div>
        ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
          <div className="flex shrink-0 flex-col items-center lg:items-start">
            <span className="font-mono text-xs uppercase tracking-[0.25em]" style={{ color: theme.ring }}>Count-up</span>
            <TimeDisplay value={fmt(countUp.elapsedSeconds)} className="font-display text-7xl font-medium tracking-tight sm:text-8xl" />
            <span className="mt-1 text-sm text-muted-foreground">Stopwatch, no countdown</span>
          </div>

          <div className="flex flex-1 flex-col gap-5">
            <p className="text-sm text-muted-foreground">
              {task
                ? <>Time logs to <span className="text-foreground">{task.title}</span> ({task.tag}) when you stop &amp; save.</>
                : "Select a task below to link this session, or just run the clock."}
            </p>
            <div className="flex items-center gap-3">
              <button onClick={() => {
                if (countUp.running) { countUp.pause(); return; }
                runSolo?.(() => { timer.reset(); unlockAudio(); countUp.start(); });
              }} className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl font-semibold text-white shadow-glow transition active:scale-[0.98]" style={{ background: theme.ring }} aria-label={countUp.running ? "Pause count-up timer" : countUp.elapsedSeconds > 0 ? "Resume count-up timer" : "Start count-up timer"}>
                {countUp.running ? <><Pause size={22} fill="currentColor" /> Pause</> : <><Play size={22} fill="currentColor" /> {countUp.elapsedSeconds > 0 ? "Resume" : "Start"}</>}
              </button>
              <button onClick={onCompleteCountUp} disabled={countUp.elapsedSeconds <= 0}
                className="h-14 rounded-2xl border border-primary/40 bg-primary/10 px-5 text-sm font-semibold text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50">Stop & save</button>
              <button onClick={countUp.reset} disabled={countUp.elapsedSeconds <= 0}
                className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" aria-label="Reset count-up timer"><RotateCcw size={19} /></button>
            </div>
          </div>
        </div>
        )}
      </section>

      {/* Same breakKey as the focus-mode checklist, so both surfaces suggest
          the same two activities during a given break. */}
      <HealthyBreakActivities active={timer.phase !== "focus"} breakKey={`solo-${timer.phase}-${timer.completedFocus}`} />
      <AdBreakPrompt active={timer.phase !== "focus" && !isPremium} onAdvertise={onAdvertise} onGoPremium={onGoPremium} />

      <FocusSoundsPanel sounds={sounds} />

      <MusicPanel embed={embed} shown={shownEmbed} onPlay={playEmbed} showPlayer stopSignal={embedStopSignal} onPlaying={onEmbedPlaying}
        dockClosed={dockClosed} onReopenDock={onReopenDock} />

      {showMethods && (
        <Modal label="Timer method" onClose={() => setShowMethods(false)}
          cardClassName="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 font-display text-lg font-semibold">Timer method
                <InfoTip text="A method sets your rhythm: how long each focus block runs, how long breaks last, and how many blocks make a cycle. Pick short Sprints or go Deep; the timer handles the switching." />
              </h3>
              <button onClick={() => setShowMethods(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="mt-3 space-y-2">
              {METHODS.map((m) => {
                const locked = m.premium && !isPremium;
                const active = m.id === methodId;
                return (
                  <button key={m.id}
                    onClick={() => {
                      if (locked) { gateThen(() => { setMethodId(m.id); setTimerMode("pomodoro"); }); return; }
                      setMethodId(m.id);
                      setTimerMode("pomodoro");
                      if (m.id !== "custom") setShowMethods(false);
                    }}
                    aria-pressed={active && timerMode === "pomodoro"}
                    className={`relative w-full rounded-2xl border p-3 text-left transition ${active && timerMode === "pomodoro" ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border bg-card/70 hover:border-primary/40"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{m.name}</span>
                      {locked && <Crown size={13} className="text-primary" />}
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{m.blurb}</p>
                  </button>
                );
              })}
            </div>
            {methodId === "custom" && <CustomEditor custom={custom} setCustom={setCustom} onSave={() => { setShowMethods(false); scrollToTimer(); }} />}
            <div className="mt-3 border-t border-border pt-3">
              <button
                onClick={() => { setTimerMode("countup"); setShowMethods(false); scrollToTimer(); }}
                aria-pressed={timerMode === "countup"}
                className={`relative w-full rounded-2xl border p-3 text-left transition ${timerMode === "countup" ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border bg-card/70 hover:border-primary/40"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Count-up timer</span>
                  <Timer size={13} className="text-primary" />
                </div>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Stopwatch mode, no countdown. Time logs to your selected task when you stop &amp; save.</p>
              </button>
            </div>
        </Modal>
      )}

      <div>
        <div className="min-w-0">
          <h2 className="mb-3 font-display text-lg font-semibold">Up next</h2>
          {upNextTags.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {["all", ...upNextTags].map((tg) => (
                <button key={tg} onClick={() => setUpNextTag(tg)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${activeUpNextTag === tg ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
                  {tg === "all" ? "All subjects" : tg}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {/* Active task pins to the top so the "Focusing" marker is always visible here. */}
            {(() => {
              const upNext = sortTasks(tasks)
                .filter((t: Task) => !t.done && (activeUpNextTag === "all" || t.tag === activeUpNextTag))
                .sort((a: Task, b: Task) => Number(b.id === activeTask) - Number(a.id === activeTask))
                .slice(0, 3);
              if (upNext.length === 0) return (
                <div className="rounded-xl border border-dashed border-border bg-card/50 p-4 text-center">
                  <p className="text-sm text-muted-foreground">0 tasks queued. Add what you'll study and it shows up here.</p>
                  <button onClick={onOpenTasks}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-primary transition hover:border-primary/40">
                    <Plus size={13} /> Add tasks
                  </button>
                </div>
              );
              return upNext.map((t: Task) => (
              <button key={t.id} onClick={() => setActiveTask(t.id)}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${activeTask === t.id ? "border-primary bg-primary/5" : "border-border bg-card/70 hover:border-primary/40"}`}>
                <span className="min-w-0 flex-1">
                  <span className="block min-w-0 truncate text-sm">{t.title}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <TagPill tag={t.tag} />
                    {activeTask === t.id && (
                      <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        <Timer size={10} /> Focusing
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground" title="Focus sessions done / planned">{t.poms}/{t.est} <span className="font-sans text-[10px]">sessions</span></span>
              </button>
              ));
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FocusTasksCard({ tasks, activeTask, setActiveTask, toggleTask, estimateReachedTask, onResolveEstimate, breakActive = false, breakKey = "" }: {
  tasks: Task[];
  activeTask: string | null;
  setActiveTask: (id: string | null) => void;
  toggleTask: (id: string) => void;
  estimateReachedTask: string | null;
  onResolveEstimate: (complete: boolean) => void;
  breakActive?: boolean;
  breakKey?: string;
}) {
  // A just-completed task lingers briefly in its "done" state before dropping
  // out, so checking it off gives visible feedback instead of a vanishing row.
  const [justDone, setJustDone] = useState<string | null>(null);
  // Optional healthy-break suggestions folded into the checklist during
  // breaks: green so they read as different from real tasks, ticking them is
  // entirely optional, and they vanish when the break ends. A fresh random
  // pair (never last break's) arrives each break via breakKey.
  const breakPicks = useBreakActivityPicks(!!breakActive, breakKey);
  const [breakDone, setBreakDone] = useState<string[]>([]);
  useEffect(() => { setBreakDone([]); }, [breakKey]);
  const open = sortTasks(tasks).filter((t: Task) => !t.done || t.id === justDone)
    .sort((a: Task, b: Task) => Number(b.id === activeTask) - Number(a.id === activeTask))
    .slice(0, 4);

  const complete = (t: Task) => {
    if (t.done) return; // the lingering row — ignore re-taps
    if (t.id === activeTask) {
      // Completing the task being focused hands the rest of the block to the
      // next open task, so the ongoing Pomodoro still credits somewhere real.
      const next = sortTasks(tasks).find((o: Task) => !o.done && o.id !== t.id);
      setActiveTask(next?.id ?? null);
    }
    setJustDone(t.id);
    toggleTask(t.id);
    window.setTimeout(() => setJustDone(null), 900);
  };

  if (tasks.length === 0 && breakPicks.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{breakPicks.length > 0 ? "On a break" : "Studying"}</span>
      {breakPicks.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {breakPicks.map((a: Activity) => {
            const done = breakDone.includes(a.id);
            return (
              <div key={a.id}
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 transition ${done ? "border-roamly-green bg-roamly-green/10" : "border-roamly-green/40 bg-roamly-green/5"}`}>
                <button onClick={() => setBreakDone((v) => (done ? v.filter((id) => id !== a.id) : [...v, a.id]))}
                  aria-pressed={done} aria-label={`Mark optional break task ${a.title} done`}
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border transition ${done ? "border-roamly-green bg-roamly-green" : "border-roamly-green/50 hover:border-roamly-green"}`}>
                  {done && <Check size={14} className="text-white" />}
                </button>
                <span className={`min-w-0 flex-1 truncate text-sm ${done ? "text-muted-foreground line-through" : ""}`} title={a.instruction}>{a.title}</span>
                <span className="shrink-0 rounded-full bg-roamly-green/10 px-2 py-0.5 text-[10px] font-semibold text-roamly-green">Optional</span>
              </div>
            );
          })}
        </div>
      )}
      {tasks.length === 0 ? null : open.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Check size={15} className="shrink-0 text-roamly-green" /> All tasks done. Ride out the timer or enjoy your break.
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {open.map((t: Task) => (
            <div key={t.id}
              className={`flex w-full flex-wrap items-center gap-2 rounded-xl border px-3 py-2 transition ${t.id === estimateReachedTask ? "border-amber-500 bg-amber-500/10" : t.done ? "border-roamly-green/40 bg-card/60" : activeTask === t.id ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:border-primary/40"}`}>
              <button onClick={() => complete(t)} aria-label={`Mark ${t.title} done`}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border transition ${t.done ? "border-roamly-green bg-roamly-green" : "border-muted-foreground/40 hover:border-primary"}`}>
                {t.done && <Check size={14} className="text-white" />}
              </button>
              <button onClick={() => { if (!t.done) setActiveTask(t.id); }} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className={`min-w-0 flex-1 truncate text-sm ${t.done ? "text-muted-foreground line-through" : ""}`}>{t.title}</span>
                {!t.done && activeTask === t.id && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    <Timer size={10} /> Focusing
                  </span>
                )}
                <span className="shrink-0 font-mono text-xs text-muted-foreground" title="Focus sessions done / planned">{t.poms}/{t.est}</span>
              </button>
              {t.id === estimateReachedTask && (
                <div className="w-full rounded-lg bg-card/80 p-2 text-xs">
                  <p className="font-medium">Hey, this task was set to be completed after {t.est} session{t.est === 1 ? "" : "s"}. Do you want to complete it?</p>
                  <div className="mt-2 flex gap-2"><button onClick={() => onResolveEstimate(true)} className="rounded-full bg-primary px-3 py-1 font-semibold text-white">Complete</button><button onClick={() => onResolveEstimate(false)} className="rounded-full border border-border px-3 py-1 text-muted-foreground">Keep open</button></div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
