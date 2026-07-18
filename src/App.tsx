import { Fragment, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Timer, ListChecks, BarChart3, Users, Check, Plus, Minus, Crown, Play, Pause, RotateCcw, SkipForward, X, Music, Palette, Flame, BellOff, CalendarClock, LogIn, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Volume2, Lock, GripVertical, HelpCircle, Pencil, Trash2, Sprout, Moon, Settings2, PictureInPicture2, CircleCheck } from "lucide-react";
import { METHODS, THEMES, sortTasks, tagColor, type Task } from "./data";
import { useTimer, fmt, type Phase } from "./useTimer";
import { FOCUS_SOUNDS, startFocusSound, stopFocusSound, setFocusVolume, focusSoundActive, unlockAudio, releaseAudioSession, musicCredit, duckFocusSound, setOnPlaybackStart, playCelebration, type FocusSoundId } from "./focusSounds";
import { SPOTIFY_PRESETS, parseSpotifyUrl, toEmbedSrc as toSpotifyEmbedSrc, embedHeight, embedSrcToUri, type SpotifyEmbedType } from "./spotify";
import { SpotifyEmbed } from "./SpotifyEmbed";
import { APPLE_MUSIC_PRESETS, parseAppleMusicUrl, toEmbedSrc as toAppleEmbedSrc, embedHeight as appleEmbedHeight, type AppleMusicEmbedType } from "./appleMusic";
const WeekChart = lazy(() => import("./Charts").then((m) => ({ default: m.WeekChart })));
const SubjectDonut = lazy(() => import("./Charts").then((m) => ({ default: m.SubjectDonut })));
import { supabase, arrivedViaEmailLink } from "./supabaseClient";
import { fetchProfile, updateGoalAndExam, recordFocusSession, fetchRecentSessions, fetchStudyEvents, fetchPlannedStudySessions, createPlannedStudySession, updatePlannedStudySession, deletePlannedStudySession, getAccessToken, fetchTasks, createTask, updateTask, deleteTask, checkIsAdmin, migrateGuestDataToAccount, fetchExamSchedules, createExamSchedule, updateExamSchedule, deleteExamSchedule, saveThemePreference, type ExamSchedule, type PlannedStudyUpdate, type Profile } from "./db";
import { addSession, computeStreak, minutesToday, dateKey, type FocusSession } from "./streaks";
import { track, setTrackUser } from "./track";
import { loadPref, savePref } from "./storage";
import { FeedbackModal } from "./Feedback";
import { useEndOfPhaseAlerts } from "./useEndOfPhaseAlerts";
import { AuthPanel, SetPasswordModal } from "./Auth";
import { ProfileMenu, loadA11y, type A11ySettings } from "./ProfileMenu";
import { AccountSettings } from "./AccountSettings";
import { SettingsModal } from "./SettingsModal";
import { RoomsLive } from "./RoomsLive";
import { FocusMode, TimeDisplay, InfoTip } from "./FocusMode";
import { PipTimer } from "./PipTimer";
import { useDocumentPip, applyThemeToPip } from "./useDocumentPip";
import { useVideoPip, type PipFrame } from "./useVideoPip";
import { useCountUpTimer } from "./useCountUpTimer";
import { Tutorial } from "./Tutorial";
import { AdminView } from "./Admin";
import { Modal } from "./Modal";
import LockedFeaturePreview from "./LockedFeaturePreview";
import { HelpLegal } from "./HelpLegal";
import { NotificationsBell } from "./Notifications";
import { FriendsModal } from "./Friends";
import { UploadTasksPanel, currentUploadPeriod, FREE_MONTHLY_UPLOAD_QUOTA, PREMIUM_MONTHLY_UPLOAD_QUOTA } from "./UploadTasks";
import { GUEST_TASK_LIMIT, loadGuestSessions, loadGuestTasks, saveGuestSessions, saveGuestTasks, clearMigratedGuestData } from "./guestData";
import { loadGuestStudyEvents, newStudyEvent, saveGuestStudyEvents, type PlannedStudyDraft, type PlannedStudySession, type StudyEvent } from "./release3";
import { PlannedStudyPanel, StudyInsights } from "./StudyInsights";
import { computeLocalGamification, fetchGamification, syncGamification, setPetActive, setRewardActive, stageProps, type Gamification, type GamSyncResult } from "./gamification";
import { GamificationView, UnlockToast } from "./GamificationView";
import { ThemedSelect } from "./ThemedSelect";
import { usePetSleep } from "./usePetSleep";
const PetStage = lazy(() => import("./PetCanvas").then((m) => ({ default: m.PetStage })));
import { HealthyBreakActivities, useBreakActivityPicks, type Activity } from "./HealthyBreakActivities";
import { useFocusMotivation, buildMotivationContext, MotivationLine } from "./useFocusMotivation";
import { ConfettiBurst } from "./Confetti";
import { CustomizeSession } from "./CustomizeSession";
import { AdBreakPrompt, AdSubmitModal } from "./AdBreak";
import type { Session } from "@supabase/supabase-js";
import { applySeo } from "./seo";

export type View = "focus" | "tasks" | "analytics" | "rooms" | "garden" | "premium" | "admin";

// A count-up session shorter than this isn't offered for saving — a few
// seconds from an accidental start is not real study time.
const MIN_COUNTUP_SAVE_SECONDS = 60;

// Every tab has its own URL (/focus, /tasks, …) so pages are linkable and the
// browser back button works. Unknown paths fall back to Focus; vercel.json
// already rewrites all non-api paths to the SPA.
const VIEW_LABELS: Record<View, string> = {
  focus: "Focus", tasks: "Tasks", analytics: "Analytics", rooms: "Rooms",
  garden: "Garden", premium: "Premium", admin: "Admin",
};
function viewFromPath(pathname: string): View {
  const slug = pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  return (Object.keys(VIEW_LABELS) as View[]).find((v) => v === slug) ?? "focus";
}

function calendarDayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export default function App() {
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname));
  const [immersive, setImmersive] = useState(false); // personal focus-mode takeover
  const [methodId, setMethodId] = useState("classic");
  // The chosen theme is restored from the device before first paint (no flash
  // of the default), and for signed-in users it also syncs to the profile so
  // the pick follows them across devices. Unknown/retired ids fall back to the
  // default rather than breaking the palette.
  const [themeId, setThemeId] = useState(() => {
    const saved = loadPref("roamly-theme");
    return saved && THEMES.some((t) => t.id === saved) ? saved : "coffee";
  });
  const [tasks, setTasks] = useState<Task[]>(loadGuestTasks);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [activeTask, setActiveTask] = useState<string | null>(() => loadGuestTasks()[0]?.id ?? null);
  const [estimateReachedTask, setEstimateReachedTask] = useState<string | null>(null);
  const [autoCompleteEstimates, setAutoCompleteEstimates] = useState(() => loadPref("roamly-auto-complete-estimates") !== "0");
  const [showUpsell, setShowUpsell] = useState(false);
  // User-editable values for the Custom method (minutes).
  const [custom, setCustom] = useState({ focus: 30, short: 7, long: 20, cycles: 4 });

  // The tour never opens automatically — the timer is the arrival experience.
  // It's reachable from the header "?", the profile menu's "App tour" row, and
  // the "How Roamly Flow works" explainer. On exit it returns the user to
  // whichever tab they were on when they started it.
  const [showTutorial, setShowTutorial] = useState(false);
  const [tourReturnView, setTourReturnView] = useState<View>("focus");
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAd, setShowAd] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessions, setSessions] = useState<FocusSession[]>(loadGuestSessions);
  const [studyEvents, setStudyEvents] = useState<StudyEvent[]>(loadGuestStudyEvents);
  const [plannedSessions, setPlannedSessions] = useState<PlannedStudySession[]>([]);
  const [examSchedules, setExamSchedules] = useState<ExamSchedule[]>([]);
  // Gamification: signed-in users get authoritative state from the server;
  // guests compute it locally from their focus history (see `gamification`).
  const [serverGam, setServerGam] = useState<Gamification | null>(null);
  const [gamPopup, setGamPopup] = useState<GamSyncResult | null>(null);
  // Companions (pets/plants on the timer) are OFF by default; opt in per device.
  const [companionsOn, setCompanionsOn] = useState(() => loadPref("roamly-companions") === "1");
  const toggleCompanions = () => setCompanionsOn((v) => { savePref("roamly-companions", v ? "0" : "1"); return !v; });
  // Completion confetti is ON by default; opt out per device (persisted).
  const [confettiOn, setConfettiOn] = useState(() => loadPref("roamly-confetti") !== "0");
  const toggleConfetti = () => setConfettiOn((v) => { savePref("roamly-confetti", v ? "0" : "1"); return !v; });
  // Themed confirm dialog, replacing the bare browser confirm() pop-ups. onConfirm
  // runs inside the modal's confirm-button click, so it is still a user gesture
  // (iOS audio unlock keeps working).
  const [confirmDialog, setConfirmDialog] = useState<null | {
    title: string; body?: string; confirmLabel: string; onConfirm: () => void;
  }>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [roomTarget, setRoomTarget] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // True when this page load came from an invite/recovery email link — the
  // user is signed in but passwordless, so we prompt them to set one.
  const [needsPassword, setNeedsPassword] = useState(arrivedViaEmailLink);
  const alerts = useEndOfPhaseAlerts();

  // Stripe Checkout returns to /?checkout=success|cancelled. Show a brief
  // confirmation and strip the param so a refresh doesn't repeat it. (Premium
  // itself flips via the webhook + the realtime profile subscription.)
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(() => {
    const value = new URLSearchParams(window.location.search).get("checkout");
    if (value === "success") return "Payment successful. Your account updates momentarily.";
    if (value === "cancelled") return "Checkout cancelled. You have not been charged.";
    return null;
  });
  useEffect(() => {
    if (!checkoutNotice) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("checkout")) {
      url.searchParams.delete("checkout");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    const timer = window.setTimeout(() => setCheckoutNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [checkoutNotice]);

  const isPremium = profile?.is_premium ?? false;
  const dailyGoal = profile?.daily_goal_minutes ?? 120;
  const streak = useMemo(() => computeStreak(sessions), [sessions]);
  const todayMinutes = useMemo(() => minutesToday(sessions), [sessions]);
  const doneTasks = useMemo(() => tasks.filter((t) => t.done).length, [tasks]);
  // Signed-in: server state once loaded; otherwise a live local computation so
  // the Garden and pets work in guest mode too (and while the server loads).
  const gamification = useMemo<Gamification>(
    () => (session && serverGam ? serverGam : computeLocalGamification(sessions, studyEvents, doneTasks)),
    [session, serverGam, sessions, studyEvents, doneTasks]
  );

  const method = useMemo(() => {
    const base = METHODS.find((m) => m.id === methodId)!;
    return base.id === "custom" ? { ...base, ...custom } : base;
  }, [methodId, custom]);

  const [a11y, setA11yState] = useState<A11ySettings>(loadA11y);
  const setA11y = (next: A11ySettings) => {
    setA11yState(next);
    savePref("roamly-a11y", JSON.stringify(next));
  };

  // Color-blind mode swaps the functional colors (focus vs break/success) to
  // the Okabe-Ito blue/orange pair, which stays distinguishable across all
  // common color-vision deficiencies. Decorative theme colors are untouched.
  const theme = useMemo(() => {
    const base = THEMES.find((t) => t.id === themeId)!;
    return a11y.colorBlind ? { ...base, ring: "#0072B2", rest: "#E69F00" } : base;
  }, [themeId, a11y.colorBlind]);

  // Track the signed-in session.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load this user's profile, recent focus sessions, and tasks whenever they sign
  // in/out. Signed-out users keep working with their local guest data.
  useEffect(() => {
    const userId = session?.user.id;
    setTrackUser(userId ?? null);
    if (!userId) {
      setProfile(null);
      const guestTasks = loadGuestTasks();
      setSessions(loadGuestSessions());
      setStudyEvents(loadGuestStudyEvents());
      setPlannedSessions([]);
      setExamSchedules([]);
      setTasks(guestTasks);
      setActiveTask(guestTasks[0]?.id ?? null);
      setTasksLoaded(true);
      return;
    }
    // Don't flash the demo SEED_TASKS at a signed-in user while theirs load.
    setTasksLoaded(false);
    let cancelled = false;
    void (async () => {
      // Fold any guest-mode work into the new account BEFORE loading server
      // data, then clear local guest storage so it can't double-apply on a
      // later sign-in. Running this first means the fetches below see the
      // migrated rows rather than racing them.
      const guestTasks = loadGuestTasks();
      const guestSessions = loadGuestSessions();
      const guestEvents = loadGuestStudyEvents();
      if (guestTasks.length > 0 || guestSessions.length > 0) {
        await migrateGuestDataToAccount(userId, guestTasks, guestSessions, guestEvents);
        clearMigratedGuestData();
        saveGuestStudyEvents([]); // carried over above; clear so a later sign-in can't re-import
      }

      const nextProfile = await fetchProfile(userId);
      if (cancelled) return;
      setProfile(nextProfile);

      // Theme preference priority: the account's saved theme wins; if the
      // account has none yet, adopt the device's current pick and save it as
      // the account preference — an intentional local selection is never
      // silently replaced with the default.
      const accountTheme = nextProfile?.theme;
      if (accountTheme && THEMES.some((t) => t.id === accountTheme)) {
        setThemeId(accountTheme);
        savePref("roamly-theme", accountTheme);
      } else if (nextProfile) {
        const localTheme = loadPref("roamly-theme");
        if (localTheme && THEMES.some((t) => t.id === localTheme)) void saveThemePreference(userId, localTheme);
      }

      const [recent, events, planned, taskRows, exams] = await Promise.all([
        fetchRecentSessions(userId),
        fetchStudyEvents(userId),
        fetchPlannedStudySessions(userId),
        fetchTasks(userId),
        fetchExamSchedules(userId),
      ]);
      if (cancelled) return;
      setSessions(recent);
      setStudyEvents(events);
      setPlannedSessions(planned);
      setExamSchedules(exams);
      setTasks(taskRows);
      setActiveTask(taskRows[0]?.id ?? null);
      setTasksLoaded(true);
    })();
    checkIsAdmin().then((admin) => { if (!cancelled) setIsAdmin(admin); });
    return () => { cancelled = true; };
  }, [session?.user.id]);

  useEffect(() => {
    if (!session && tasksLoaded) saveGuestTasks(tasks);
  }, [session, tasksLoaded, tasks]);

  useEffect(() => {
    if (!session) saveGuestSessions(sessions);
  }, [session, sessions]);

  useEffect(() => { if (!session) saveGuestStudyEvents(studyEvents); }, [session, studyEvents]);

  // Reflect a Stripe webhook's is_premium update live, without a manual refresh.
  useEffect(() => {
    if (!supabase || !session?.user.id) return;
    const client = supabase; // narrowed to non-null for the cleanup closure below
    const channel = client
      .channel(`profile-${session.user.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${session.user.id}` },
        () => { void fetchProfile(session.user.id).then(setProfile); })
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [session?.user.id]);

  // Recompute server-side gamification after a completed session and surface
  // any newly-unlocked achievements/pets/rewards as a toast. No-op for guests —
  // their state is derived live from local history in `gamification`.
  const bumpGamification = useCallback(async () => {
    if (!session?.user.id) return;
    const res = await syncGamification();
    if (res && (res.new_achievements.length || res.new_pets.length || res.new_rewards.length)) setGamPopup(res);
    const g = await fetchGamification();
    if (g) setServerGam(g);
  }, [session?.user.id]);

  // Sync + load gamification whenever the signed-in user changes.
  useEffect(() => {
    if (!session?.user.id) { setServerGam(null); return; }
    let cancelled = false;
    void (async () => {
      await syncGamification();
      const g = await fetchGamification();
      if (!cancelled && g) setServerGam(g);
    })();
    return () => { cancelled = true; };
  }, [session?.user.id]);

  // Refresh gamification when opening the Garden so room-earned XP (credited
  // from RoomsLive) and any other drift show up without a reload.
  useEffect(() => {
    if (view !== "garden" || !session?.user.id) return;
    void fetchGamification().then((g) => { if (g) setServerGam(g); });
  }, [view, session?.user.id]);

  // Bumped once per NATURALLY completed focus block; ConfettiBurst plays one
  // celebration per bump (and skips itself under reduced motion).
  const [confettiBurst, setConfettiBurst] = useState(0);

  // The one celebration entry point, shared by the personal timer and rooms:
  // full-screen confetti plus the "fireworks" sound. The confetti visual always
  // fires (ConfettiBurst self-skips under reduced motion); the sound respects
  // the completion-sound toggle so muting it silences the fireworks too.
  const celebrateFocusComplete = useCallback(() => {
    setConfettiBurst((n) => n + 1);
    if (alerts.soundEnabled) playCelebration();
  }, [alerts.soundEnabled]);

  const handlePhaseComplete = useCallback((finishedPhase: Phase) => {
    alerts.notify(finishedPhase);
    if (finishedPhase !== "focus") return;
    // useTimer fires this callback ONLY when a phase runs down to 00:00
    // naturally (skip/reset never reach it), so this is the one true
    // "focus block completed" moment — celebrate it. Purely additive:
    // sounds, notifications, tracking, and auto-flow all continue below.
    celebrateFocusComplete();
    track("focus_block_done");
    // Credit the completed Pomodoro to whichever task was active when the phase finished.
    const current = activeTask ? tasks.find((t) => t.id === activeTask) : undefined;
    if (current) {
      const nextPoms = current.poms + 1;
      const finished = nextPoms >= current.est && !current.done;
      const shouldComplete = finished && autoCompleteEstimates;
      setTasks((prev) => prev.map((t) => (t.id === activeTask ? { ...t, poms: nextPoms, done: shouldComplete ? true : t.done } : t)));
      if (session?.user.id) updateTask(activeTask!, shouldComplete ? { poms: nextPoms, done: true } : { poms: nextPoms });
      if (finished && !shouldComplete) setEstimateReachedTask(current.id);
      if (shouldComplete) {
        // The task hit its session estimate — complete it and hand focus to
        // the next open task so the following block credits somewhere real.
        track("task_done");
        const next = sortTasks(tasks).find((o) => !o.done && o.id !== current.id);
        setActiveTask(next?.id ?? null);
      }
    }
    setSessions((prev) => addSession(prev, method.focus));
    const event = newStudyEvent(method.focus, current, "countdown");
    setStudyEvents((prev) => [...prev, event]);
    if (session?.user.id) void recordFocusSession(dateKey(), method.focus, current, "countdown").then((ok) => { if (ok) void bumpGamification(); });
  }, [alerts.notify, celebrateFocusComplete, session?.user.id, method.focus, activeTask, tasks, autoCompleteEstimates, bumpGamification]);

  // Auto-flow: roll straight from focus into break (and back) like rooms do,
  // for users who don't want to press Start at every boundary. Default off —
  // the classic "own your start" behavior.
  const [autoFlow, setAutoFlow] = useState(() => loadPref("roamly-autostart") === "1");
  const toggleAutoFlow = () => setAutoFlow((v) => { savePref("roamly-autostart", v ? "0" : "1"); return !v; });
  const timer = useTimer(method, handlePhaseComplete, autoFlow, alerts.playEndingChime);
  const countUp = useCountUpTimer();

  // One AI-personalized motivational line per new focus session, from context
  // the app already holds (active task, nearest exam, open-task subjects).
  // The hook owns session detection and duplicate-request prevention.
  const motivationContext = useCallback(() => buildMotivationContext({
    activeTask: activeTask ? tasks.find((t) => t.id === activeTask) : null,
    exams: examSchedules,
    tasks,
  }), [activeTask, tasks, examSchedules]);
  const motivation = useFocusMotivation(timer, method.focus * 60, !!session, motivationContext);

  // Companions on the timer: which pets/plant to draw, and the "too distracting"
  // sleep state (they nap until the focus block ends). Hidden entirely when the
  // device pref is off or nothing is active.
  const petSleep = usePetSleep(timer);
  const companionStage = useMemo(() => stageProps(gamification), [gamification]);
  const showCompanions = companionsOn && (companionStage.pets.length > 0 || !!companionStage.plant);
  const petStageNode = showCompanions ? (
    <Suspense fallback={null}>
      <PetStage pets={companionStage.pets} plant={companionStage.plant} accessories={companionStage.accessories} asleep={petSleep.asleep} reduceMotion={a11y.reduceMotion} className="h-full w-full" />
    </Suspense>
  ) : null;
  const toggleSleep = () => (petSleep.asleep ? petSleep.wake() : petSleep.sleep());

  const completeCountUp = useCallback(() => {
    // Snapshot elapsed BEFORE opening the dialog so the saved duration matches
    // what the user saw, not whatever the clock reads when they confirm.
    const elapsed = countUp.elapsedSeconds;
    if (elapsed <= 0) return;
    // Trivially short sessions (e.g. a few seconds from an accidental start)
    // are not real study time; discard them silently instead of prompting.
    if (elapsed < MIN_COUNTUP_SAVE_SECONDS) { countUp.reset(); return; }
    setConfirmDialog({
      title: "Save this session?",
      body: `Save this ${fmt(elapsed)} focus session to Analytics?`,
      confirmLabel: "Save",
      onConfirm: () => {
        countUp.stop();
        const minutes = Math.max(1, Math.ceil(elapsed / 60));
        const current = activeTask ? tasks.find((t) => t.id === activeTask) : undefined;
        setSessions((prev) => addSession(prev, minutes));
        setStudyEvents((prev) => [...prev, newStudyEvent(minutes, current, "count_up")]);
        if (session?.user.id) void recordFocusSession(dateKey(), minutes, current, "count_up").then((ok) => { if (ok) void bumpGamification(); });
        track("count_up_complete", String(minutes));
      },
    });
  }, [countUp, session?.user.id, activeTask, tasks, bumpGamification]);

  const createStudyPlan = useCallback(async (row: PlannedStudyDraft): Promise<PlannedStudySession | null> => {
    if (!session?.user.id) return null;
    const created = await createPlannedStudySession(session.user.id, row);
    if (created) setPlannedSessions((prev) => [created, ...prev]);
    return created;
  }, [session?.user.id]);

  const updateStudyPlan = useCallback(async (id: string, fields: PlannedStudyUpdate): Promise<boolean> => {
    if (!session?.user.id || !await updatePlannedStudySession(id, fields)) return false;
    setPlannedSessions((prev) => prev.map((plan) => plan.id === id ? { ...plan, ...fields } : plan));
    return true;
  }, [session?.user.id]);

  const deleteStudyPlan = useCallback(async (id: string): Promise<boolean> => {
    if (!session?.user.id || !await deletePlannedStudySession(id)) return false;
    setPlannedSessions((prev) => prev.filter((plan) => plan.id !== id));
    return true;
  }, [session?.user.id]);

  // Picture-in-Picture: pop the timer into a small always-on-top window so it
  // stays visible while the user studies in other apps/tabs (desktop Chromium).
  const { pipWindow, supported: pipSupported, openPip, closePip } = useDocumentPip(theme, a11y);
  // Safari (and other non-Chromium engines) can't do Document PiP, so the
  // PERSONAL timer falls back to a display-only video-PiP window. Rooms keep
  // Document-PiP only. The frame is read live each redraw from the timer.
  const pipFrame = useCallback((): PipFrame => ({
    timeText: fmt(timer.secondsLeft),
    phaseLabel: timer.phase === "focus" ? "Focus" : timer.phase === "short" ? "Short break" : "Long break",
    progress: timer.progress,
    ring: timer.phase === "focus" ? theme.ring : theme.rest,
    bg: `hsl(${theme.vars["--background"]})`,
    fg: `hsl(${theme.vars["--foreground"]})`,
    muted: `hsl(${theme.vars["--muted-foreground"]})`,
  }), [timer, theme]);
  const videoPip = useVideoPip(pipFrame);
  const personalPipSupported = pipSupported || videoPip.supported;
  const personalPipActive = !!pipWindow || videoPip.active;
  const openPersonalPip = useCallback(
    () => (pipSupported ? openPip() : videoPip.open()),
    [pipSupported, openPip, videoPip],
  );
  const closePersonalPip = useCallback(
    () => { if (pipSupported) closePip(); else videoPip.close(); },
    [pipSupported, closePip, videoPip],
  );

  // --- Built-in focus sounds (free for everyone) ---
  // Melody is preselected so music plays the moment anyone hits Start, with no
  // setup; the "Play with timer" toggle is the off switch. A saved pick (or a
  // saved "off" from a streaming-embed takeover) always wins over the default.
  const [focusSound, setFocusSound] = useState<FocusSoundId | null>(() => {
    const saved = loadPref("roamly-focus-sound");
    if (saved === "off") return null;
    // A saved pick for a since-removed sound (e.g. an old "rain") must not load
    // an invalid station — only honour ids still in the picker, else Melody.
    const valid = new Set<string>(FOCUS_SOUNDS.map((s) => s.id));
    if (saved && valid.has(saved)) return saved as FocusSoundId;
    return FOCUS_SOUNDS[Math.floor(Math.random() * FOCUS_SOUNDS.length)].id;
  });
  const [soundAuto, setSoundAuto] = useState(() => loadPref("roamly-sound-auto") !== "off");
  const [soundVolume, setSoundVolume] = useState(() => {
    const v = parseFloat(loadPref("roamly-sound-vol") ?? "0.5");
    return Number.isNaN(v) ? 0.5 : v;
  });
  const [soundPlaying, setSoundPlaying] = useState(false);
  // The ONE Spotify/Apple embed, held at App level and rendered in a
  // persistent mini-dock — so streaming music keeps playing across tab
  // switches instead of dying when a panel unmounts.
  const [embed, setEmbed] = useState<{ service: "spotify" | "apple"; src: string; height: number; label: string } | null>(null);

  // Keep the two audio sources exclusive without manual pausing:
  //  * Focus sound starts (any path: picker, timer auto-play, room music) →
  //    embedStopSignal bumps; the Spotify player pauses via its API and the
  //    Apple iframe remounts (a reload is the only way to stop a plain embed).
  //  * Spotify playback starts inside the player → onEmbedPlaying stops the
  //    focus sound. Apple's embed has no play-detection API, so that direction
  //    only exists for Spotify; picking an Apple station still takes over via
  //    playEmbed below.
  const [embedStopSignal, setEmbedStopSignal] = useState(0);
  useEffect(() => {
    setOnPlaybackStart(() => setEmbedStopSignal((n) => n + 1));
    return () => setOnPlaybackStart(null);
  }, []);
  const onEmbedPlaying = useCallback(() => {
    if (focusSoundActive()) stopFocusSound();
    setSoundPlaying(false);
  }, []);
  const playEmbed = (t: { service: "spotify" | "apple"; src: string; height: number; label: string }) => {
    // Streaming takes over — silence and deselect the built-in focus sound.
    track("embed_play");
    stopFocusSound();
    setSoundPlaying(false);
    setFocusSound(null);
    savePref("roamly-focus-sound", "off");
    setEmbed(t);
    // Picking music IS the intentional activation — surface the mini-player
    // (it stays completely closed until this moment on a fresh device).
    setDockClosed(false);
    savePref("roamly-dock-closed", "0");
  };
  // The selected service lives in state (not just the pref) so the dock's
  // fallback stays on the chosen service even after `embed` is cleared —
  // e.g. when picking a built-in sound resets the streaming player.
  const [dockService, setDockService] = useState<"spotify" | "apple">(() => loadPref("roamly-music-service") === "apple" ? "apple" : "spotify");
  // The dock preloads the selected service's first preset so both streaming
  // players are visibly available before any station is picked.
  const defaultEmbed = useMemo(() => {
    if (dockService === "apple") {
      const p = APPLE_MUSIC_PRESETS[0] as any;
      return { service: "apple" as const, src: toAppleEmbedSrc({ type: p.type, path: p.path }), height: appleEmbedHeight(p.type), label: p.name };
    }
    const p = SPOTIFY_PRESETS[0] as any;
    return { service: "spotify" as const, src: toSpotifyEmbedSrc({ type: p.type, id: p.spotifyId }), height: embedHeight(p.type), label: p.name };
  }, [dockService]);
  const shownEmbed = embed ?? defaultEmbed;
  // Service switch from inside the dock itself: loads the picked service's
  // first preset, and remembers the choice for the next visit's preload.
  const pickDockService = (svc: "spotify" | "apple") => {
    setDockService(svc);
    savePref("roamly-music-service", svc);
    if (shownEmbed.service === svc) return;
    if (svc === "apple") {
      const p = APPLE_MUSIC_PRESETS[0] as any;
      playEmbed({ service: "apple", src: toAppleEmbedSrc({ type: p.type, path: p.path }), height: appleEmbedHeight(p.type), label: p.name });
    } else {
      const p = SPOTIFY_PRESETS[0] as any;
      playEmbed({ service: "spotify", src: toSpotifyEmbedSrc({ type: p.type, id: p.spotifyId }), height: embedHeight(p.type), label: p.name });
    }
  };
  // Phones default to the slim pill — a full player pinned over the bottom of
  // a small viewport hides tappable content. The user's own choice sticks.
  const [dockMin, setDockMin] = useState(() => {
    const saved = loadPref("roamly-dock-min");
    if (saved !== null) return saved === "1";
    return window.innerWidth < 640;
  });
  const toggleDockMin = () => setDockMin((m) => { savePref("roamly-dock-min", m ? "0" : "1"); return !m; });
  // The mini-player stays completely closed until the user intentionally
  // starts music or opens it from the Music panel — a first-time visitor sees
  // no floating player and no streaming iframes load with the page. Once music
  // exists, closing only hides the dock (playback continues); the choice
  // persists per device.
  const [dockClosed, setDockClosed] = useState(() => {
    const saved = loadPref("roamly-dock-closed");
    return saved === null ? true : saved === "1";
  });
  const closeDock = () => { setDockClosed(true); savePref("roamly-dock-closed", "1"); };
  const reopenDock = () => { setDockClosed(false); savePref("roamly-dock-closed", "0"); };

  const sounds = {
    sound: focusSound,
    auto: soundAuto,
    volume: soundVolume,
    playing: soundPlaying,
    choose: (id: FocusSoundId) => {
      unlockAudio(); // synchronous, inside the tap — required by iOS
      track("music_play", id);
      savePref("roamly-focus-sound", id);
      setEmbed(null); // built-in chosen — close the streaming mini-dock
      if (focusSound === id && soundPlaying) { stopFocusSound(); setSoundPlaying(false); return; }
      setFocusSound(id);
      startFocusSound(id, soundVolume);
      setSoundPlaying(true);
    },
    toggle: () => {
      if (!focusSound) return;
      unlockAudio();
      if (soundPlaying) { stopFocusSound(); setSoundPlaying(false); }
      else { startFocusSound(focusSound, soundVolume); setSoundPlaying(true); }
    },
    setAuto: (next: boolean) => {
      setSoundAuto(next);
      savePref("roamly-sound-auto", next ? "on" : "off");
    },
    setVolume: (v: number) => {
      setSoundVolume(v);
      savePref("roamly-sound-vol", String(v));
      setFocusVolume(v);
    },
  };

  // While the user is inside a study room, the room owns the audio engine (its
  // own music, synced to the shared timer). This ref lets the personal-timer
  // sound sync below stand down so the two never fight over the singleton engine.
  const inRoomRef = useRef(false);
  // `roomActive` mirrors the ref as state so the personal pop-out timer yields
  // the single PiP window to the room's own pop-out while a room is open.
  const [roomActive, setRoomActive] = useState(false);
  // One timer at a time: joining a room stops any running solo session…
  const timerRef = useRef(timer);
  timerRef.current = timer;
  const handleInRoom = useCallback((v: boolean) => {
    inRoomRef.current = v;
    setRoomActive(v);
    if (v) { timerRef.current.reset(); countUp.reset(); setImmersive(false); }
  }, [countUp.reset]);
  // …and starting a solo session while in a room asks the user to leave it
  // first (bumping leaveSignal makes RoomsLive exit the active room).
  const [leaveSignal, setLeaveSignal] = useState(0);
  // Run a solo-start action, first asking (with a themed dialog) to leave any
  // active room. Not in a room: run immediately so the click stays a single
  // user gesture (iOS audio unlock). In a room: the action runs on the modal's
  // confirm click, which is itself a gesture, after signaling RoomsLive to exit.
  const runSolo = useCallback((action: () => void) => {
    if (!inRoomRef.current) { action(); return; }
    setConfirmDialog({
      title: "Leave the study room?",
      body: "You're in a group study room. Leave it and start your solo timer?",
      confirmLabel: "Leave & start",
      onConfirm: () => { setLeaveSignal((s) => s + 1); action(); },
    });
  }, []);

  // Sound follows the timer: plays during a running focus block, fades out for
  // breaks and pauses. Lives here (not in the panel) so it keeps working when
  // the user browses other tabs mid-session. It only reacts to TIMER
  // transitions — manual previews while the timer is idle, and manual pauses
  // mid-focus, are left alone.
  const prevShouldPlay = useRef(false);
  useEffect(() => {
    if (inRoomRef.current) return; // a room is driving the engine
    if (!soundAuto || !focusSound) return;
    const shouldPlay = timer.running && timer.phase === "focus";
    if (shouldPlay === prevShouldPlay.current) return;
    prevShouldPlay.current = shouldPlay;
    if (shouldPlay) {
      if (!focusSoundActive()) { startFocusSound(focusSound, soundVolume); setSoundPlaying(true); }
      else setFocusVolume(soundVolume);
    } else if (focusSoundActive()) {
      // Keep the same performance alive but silent between phases. Rebuilding
      // the audio graph at every focus block made music restart from the top.
      setFocusVolume(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.running, timer.phase, soundAuto, focusSound]);

  // Usage ping when a session actually starts running (throttled in track()).
  useEffect(() => {
    if (timer.running) track("timer_start");
  }, [timer.running]);

  // Hand the audio session back to the OS when nothing needs it. The silent
  // iOS "keeper" loop must run while a session is live (so chimes beat the
  // hardware silent switch), but left alone it pins a Now Playing tile on the
  // lock screen forever and drains battery. The delay lets an end-of-phase
  // chime ring out before the release; any Start tap re-acquires everything.
  useEffect(() => {
    if (roomActive || timer.running || countUp.running || soundPlaying) return;
    const idle = window.setTimeout(() => releaseAudioSession(), 3000);
    return () => window.clearTimeout(idle);
  }, [roomActive, timer.running, countUp.running, soundPlaying]);

  // Dim the music over the last ~5s of a focus block so it flows into the
  // break. The timer re-renders several times a second, so a ref guards the
  // duck to fire once per focus phase (reset when we leave the focus phase).
  const duckedRef = useRef(false);
  useEffect(() => {
    if (timer.phase !== "focus" || !timer.running) { duckedRef.current = false; return; }
    if (timer.secondsLeft <= 4 && timer.secondsLeft > 0 && !duckedRef.current && focusSoundActive()) {
      duckedRef.current = true;
      duckFocusSound(3);
    }
  }, [timer.secondsLeft, timer.running, timer.phase]);

  const nav: { id: View; label: string; icon: typeof Timer; locked?: boolean }[] = [
    { id: "focus", label: "Focus", icon: Timer },
    { id: "tasks", label: "Tasks", icon: ListChecks },
    { id: "rooms", label: "Rooms", icon: Users },
    { id: "garden", label: "Garden", icon: Sprout, locked: !session },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "premium", label: "Premium", icon: Crown },
  ];

  const gateThen = (fn: () => void) => (isPremium ? fn() : setShowUpsell(true));

  // Pick which pet/plant/accessory is shown on the timer (signed-in only).
  // Only one plant/tree grows at a time, and only one accessory fits each
  // slot (bed/hat/face/toy/bowl), so activating one turns its rivals off.
  const onToggleCompanion = useCallback(async (kind: "pet" | "reward", id: string, active: boolean) => {
    if (!session?.user.id) return;
    if (kind === "pet") {
      await setPetActive(id, active);
    } else {
      if (active) {
        const target = (serverGam?.rewards ?? []).find((r) => r.id === id);
        const rivals = (serverGam?.rewards ?? []).filter((r) => {
          if (!r.is_active || r.id === id) return false;
          if (target?.kind === "accessory") return r.kind === "accessory" && r.meta.slot === target.meta.slot;
          return r.kind === "plant" || r.kind === "tree";
        });
        await Promise.all(rivals.map((r) => setRewardActive(r.id, false)));
      }
      await setRewardActive(id, active);
    }
    const gg = await fetchGamification();
    if (gg) setServerGam(gg);
  }, [session?.user.id, serverGam]);

  const onSignIn = () => setShowAuth(true);
  const onSignOut = () => supabase?.auth.signOut();
  const openTutorial = useCallback(() => {
    setTourReturnView(view);
    setShowTutorial(true);
  }, [view]);
  // "How Roamly Flow works": the compact site explanation, opened only by its
  // link (never automatically).
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showHelpLegal, setShowHelpLegal] = useState(false);
  // Customize Session drawer, lifted to App level so the same button/drawer is
  // shared by the normal timer and the immersive focus-mode overlay.
  const [showCustomize, setShowCustomize] = useState(false);
  const changeTheme = (id: string) => {
    setThemeId(id);
    savePref("roamly-theme", id); // guests keep it on this device; no expiry
    if (session?.user.id) void saveThemePreference(session.user.id, id); // signed-in: follow the account
    track("theme_change", id);
  };

  // A notification ("X invited you to a room") lands the user in that room.
  const openRoomFromNotification = useCallback((roomId: string) => {
    setRoomTarget(roomId);
    setView("rooms");
  }, []);
  const openFriends = useCallback(() => setShowFriends(true), []);
  const handleUsernameSet = useCallback((username: string) => {
    setProfile((p) => (p ? { ...p, username, display_name: p.display_name ?? username } : p));
  }, []);

  const setDailyGoal = (minutes: number) => {
    setProfile((p) => (p ? { ...p, daily_goal_minutes: minutes } : p));
    if (session?.user.id) updateGoalAndExam(session.user.id, { daily_goal_minutes: minutes });
  };
  const addExam = useCallback(async (name: string, date: string): Promise<boolean> => {
    if (!session?.user.id) return false;
    const created = await createExamSchedule(session.user.id, name, date);
    if (!created) return false;
    setExamSchedules((current) => [...current, created].sort((a, b) => a.exam_date.localeCompare(b.exam_date)));
    return true;
  }, [session?.user.id]);
  const editExam = useCallback(async (id: string, name: string, date: string): Promise<boolean> => {
    const updated = await updateExamSchedule(id, { name, exam_date: date });
    if (!updated) return false;
    setExamSchedules((current) => current.map((exam) => exam.id === id ? updated : exam).sort((a, b) => a.exam_date.localeCompare(b.exam_date)));
    return true;
  }, []);
  const removeExam = useCallback(async (id: string): Promise<boolean> => {
    if (!await deleteExamSchedule(id)) return false;
    setExamSchedules((current) => current.filter((exam) => exam.id !== id));
    return true;
  }, []);

  // Task CRUD: optimistic local update always; when signed in, also persist to
  // Supabase (tasks table) so they survive across devices/sessions.
  const addTask = useCallback((title: string, tag: string, est = 1) => {
    track("task_add");
    const userId = session?.user.id;
    const nextOrder = tasks.reduce((m, t) => Math.max(m, t.sort_order ?? 0), 0) + 1;
    const clampedEst = Math.max(1, Math.min(9, Math.round(est)));
    if (userId) {
      createTask(userId, title, tag, nextOrder, clampedEst).then((row) => {
        if (row) setTasks((prev) => [...prev, row]);
      });
    } else {
      setTasks((prev) => prev.length >= GUEST_TASK_LIMIT ? prev : [...prev, { id: crypto.randomUUID(), title, tag, done: false, poms: 0, est: clampedEst, sort_order: nextOrder }]);
    }
  }, [session?.user.id, tasks]);

  // Move a task to a target position within its subject group (open tasks
  // only) — used by both the arrow buttons and press-and-hold dragging.
  // Tasks that predate the sort_order column are first normalized to 1..n in
  // the current visual order, so positions are always well-defined.
  const reorderTask = useCallback((id: string, targetIndex: number) => {
    const sorted = sortTasks(tasks);
    const needsNormalize = sorted.some((t, i) => t.sort_order == null || sorted.findIndex((o) => o.sort_order === t.sort_order) !== i);
    const orders = new Map(sorted.map((t, i) => [t.id, needsNormalize ? i + 1 : (t.sort_order as number)]));

    const me = sorted.find((t) => t.id === id);
    if (!me) return;
    const group = sorted.filter((t) => !t.done && t.tag === me.tag);
    const from = group.findIndex((t) => t.id === id);
    const to = Math.max(0, Math.min(targetIndex, group.length - 1));
    if (from < 0 || to === from) return;

    // The group keeps its existing order slots; only membership order changes.
    const slots = group.map((t) => orders.get(t.id)!);
    const ids = group.map((t) => t.id);
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    ids.forEach((tid, i) => orders.set(tid, slots[i]));

    setTasks((prev) => prev.map((t) => (orders.get(t.id) !== t.sort_order ? { ...t, sort_order: orders.get(t.id) } : t)));
    if (session?.user.id) {
      for (const t of sorted) {
        const next = orders.get(t.id)!;
        if (next !== t.sort_order) updateTask(t.id, { sort_order: next });
      }
    }
  }, [tasks, session?.user.id]);

  const focusTask = useCallback((id: string) => {
    setActiveTask(id);
    setView("focus");
  }, []);

  const toggleTask = useCallback((id: string) => {
    const current = tasks.find((t) => t.id === id);
    if (!current) return;
    const nextDone = !current.done;
    if (nextDone) track("task_done");
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: nextDone } : t)));
    if (nextDone && activeTask === id) {
      const next = sortTasks(tasks).find((task) => !task.done && task.id !== id);
      setActiveTask(next?.id ?? null);
    }
    if (session?.user.id) updateTask(id, { done: nextDone });
  }, [tasks, session?.user.id, activeTask]);

  const resolveEstimateReached = useCallback((complete: boolean) => {
    const id = estimateReachedTask;
    if (!id) return;
    const current = tasks.find((t) => t.id === id);
    if (!current) { setEstimateReachedTask(null); return; }
    if (complete) {
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, done: true } : t));
      if (session?.user.id) updateTask(id, { done: true });
      const next = sortTasks(tasks).find((t) => !t.done && t.id !== id);
      if (activeTask === id) setActiveTask(next?.id ?? null);
      track("task_done");
    } else {
      const nextEstimate = Math.min(9, Math.max(current.est + 1, current.poms + 1));
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, est: nextEstimate } : t));
      if (session?.user.id) updateTask(id, { est: nextEstimate });
    }
    setEstimateReachedTask(null);
  }, [estimateReachedTask, tasks, session?.user.id, activeTask]);

  const toggleAutoCompleteEstimates = useCallback(() => {
    setAutoCompleteEstimates((current) => {
      const next = !current;
      savePref("roamly-auto-complete-estimates", next ? "1" : "0");
      return next;
    });
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (session?.user.id) deleteTask(id);
  }, [session?.user.id]);

  // Expiring trials/promotions/admin grants are re-evaluated at their exact
  // boundary even if the user leaves the app open for days.
  useEffect(() => {
    if (!session?.user.id || !profile?.premium_expires_at) return;
    const delay = new Date(profile.premium_expires_at).getTime() - Date.now();
    if (delay <= 0) { void fetchProfile(session.user.id).then(setProfile); return; }
    const timeout = window.setTimeout(() => { void fetchProfile(session.user.id).then(setProfile); }, Math.min(delay + 1000, 2_147_000_000));
    return () => window.clearTimeout(timeout);
  }, [session?.user.id, profile?.premium_expires_at]);

  const editTask = useCallback((id: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setTasks((prev) => prev.map((task) => task.id === id ? { ...task, title: nextTitle } : task));
    if (session?.user.id) updateTask(id, { title: nextTitle });
  }, [session?.user.id]);

  // Move a task into another subject (from the task's subject badge). The
  // task list re-groups instantly because grouping derives from the tag.
  const setTaskTag = useCallback((id: string, tag: string) => {
    const nextTag = tag.trim().slice(0, 24);
    if (!nextTag) return;
    setTasks((prev) => prev.map((task) => task.id === id ? { ...task, tag: nextTag } : task));
    if (session?.user.id) updateTask(id, { tag: nextTag });
  }, [session?.user.id]);

  // How many focus sessions a task is planned to take (1 = done in a single
  // Pomodoro). Reaching the estimate auto-completes the task.
  const setTaskEst = useCallback((id: string, est: number) => {
    const clamped = Math.max(1, Math.min(9, Math.round(est)));
    if (!Number.isFinite(clamped)) return;
    setTasks((prev) => prev.map((task) => task.id === id ? { ...task, est: clamped } : task));
    if (session?.user.id) updateTask(id, { est: clamped });
  }, [session?.user.id]);

  // Tasks generated server-side by /api/generate-tasks are already persisted —
  // just prepend them to local state, no additional Supabase call needed.
  const addImportedTasks = useCallback((rows: Task[]) => {
    track("task_ai_upload");
    setTasks((prev) => [...prev, ...rows]);
  }, []);

  // Subscription plans and one-time AI-upload credit packs are selected
  // server-side so price IDs never come from the browser.
  const startCheckout = useCallback(async (choiceArg?: "small" | "large" | "monthly" | "annual") => {
    // Sanitize: this is also wired directly as an onClick handler, where the
    // click event would arrive as the first argument.
    const choice = ["small", "large", "monthly", "annual"].includes(choiceArg as string) ? choiceArg : "monthly";
    const pack = choice === "small" || choice === "large" ? choice : undefined;
    const plan = choice === "annual" ? "annual" : "monthly";
    if (!session) { setShowAuth(true); return; }
    setCheckoutError(null);
    setCheckoutLoading(true);
    if (pack) track("buy_credits", pack);
    try {
      const token = await getAccessToken();
      if (!token) { setCheckoutLoading(false); setShowAuth(true); return; }
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(pack ? { action: "checkout", pack } : { action: "checkout", plan }),
      });
      if (!res.ok) {
        // Show the endpoint's actual message (e.g. a Stripe misconfiguration)
        // instead of a generic guess; it makes setup problems diagnosable.
        const body = await res.json().catch(() => ({}));
        setCheckoutError(body?.error || "Payments aren't set up yet. Check back soon.");
        setCheckoutLoading(false);
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setCheckoutError("Couldn't reach the payments server. Try again soon.");
      setCheckoutLoading(false);
    }
  }, [session]);

  // Each tab opens at the top (carrying the previous tab's scroll position
  // over is disorienting, especially on phones), gets its own URL, and sets
  // the document title. Search + hash are preserved: the Stripe return param
  // and Supabase email-link hash both ride along untouched.
  useEffect(() => {
    window.scrollTo(0, 0);
    track(`view_${view}`);
    const target = `/${view}`;
    if (window.location.pathname !== target) {
      // Same view, different path (first load at "/" or an alias) normalizes
      // in place; an actual tab change pushes a history entry so Back works.
      const method = viewFromPath(window.location.pathname) === view ? "replaceState" : "pushState";
      history[method](null, "", target + window.location.search + window.location.hash);
    }
    // Per-view title, description, canonical, OG/Twitter, and robots directive.
    applySeo(view);
  }, [view]);

  // Browser back/forward drives the view.
  useEffect(() => {
    const onPop = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Apply the active theme's palette to the document root so every CSS variable
  // (background, card, primary, etc.) updates live across the whole app.
  // Accessibility overrides layer on top: they must run here (not as CSS
  // classes) because the theme vars are inline styles, which beat stylesheets.
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.classList.toggle("dark", !!theme.dark);
    // Declare the color scheme so native controls (select dropdowns, date and
    // number spinners, scrollbars) render light on light themes instead of the
    // OS-dark popup that appears when the page leaves color-scheme unset.
    root.style.colorScheme = theme.dark ? "dark" : "light";
    if (a11y.colorBlind) root.style.setProperty("--roamly-green", "41 100% 45%"); // Okabe-Ito orange
    else root.style.removeProperty("--roamly-green"); // fall back to the stylesheet green
    if (a11y.highContrast) {
      root.style.setProperty("--muted-foreground", theme.vars["--foreground"]);
      root.style.setProperty("--border", theme.vars["--foreground"]);
    }
    root.classList.toggle("a11y-reduce-motion", a11y.reduceMotion);
    root.style.fontSize = a11y.largeText ? "112.5%" : "";
  }, [theme, a11y]);

  // Keep an open Picture-in-Picture window's palette in sync when the theme or
  // accessibility settings change (its document has its own root to restyle).
  useEffect(() => {
    if (pipWindow) applyThemeToPip(pipWindow, theme, a11y);
  }, [pipWindow, theme, a11y]);

  return (
    <div className="min-h-dvh w-full text-foreground font-sans" style={{ background: `linear-gradient(160deg, ${theme.grad[0]} 0%, ${theme.grad[1]} 90%)` }}>
      {/* Keyboard users land here first: a link that jumps past the header and
          nav straight to the active tab's content. Off-screen until focused. */}
      <a href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-full focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary">
        Skip to content
      </a>
      <OfflineBanner />
      {checkoutNotice && (
        <div role="status" className="fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-lg">
            <Check size={15} className="shrink-0 text-roamly-green" /> {checkoutNotice}
            <button onClick={() => setCheckoutNotice(null)} aria-label="Dismiss" className="ml-1 text-muted-foreground hover:text-foreground"><X size={14} /></button>
          </div>
        </div>
      )}
      {/* Bottom padding clears the nav PLUS the persistent music-dock pill, so
          page-end content can always scroll fully above the fixed chrome. */}
      <div className="relative mx-auto flex w-full max-w-6xl flex-col px-5 pb-[calc(11rem+env(safe-area-inset-bottom))] pt-7 md:px-8">
        <Header isPremium={isPremium} streak={streak} session={session} profile={profile}
          onSignIn={onSignIn} onSignOut={onSignOut}
          onOpenAccount={() => setShowAccount(true)}
          onOpenRoom={openRoomFromNotification} onOpenFriends={openFriends} onOpenPlannedStudy={() => setView("tasks")}
          onOpenPremium={() => setView("premium")}
          onOpenSettings={() => setShowSettings(true)}
          isAdmin={isAdmin} onOpenAdmin={() => setView("admin")}
          themeId={themeId} setThemeId={changeTheme} theme={theme}
          onGoHome={() => setView("focus")}
          onOpenFeedback={() => (session ? setShowFeedback(true) : setShowAuth(true))} />
        {view !== "focus" && (
          <nav aria-label="Breadcrumb" className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <button onClick={() => setView("focus")} className="transition hover:text-foreground">Roamly Flow</button>
            <ChevronRight size={12} aria-hidden="true" />
            <span className="font-medium text-foreground" aria-current="page">{VIEW_LABELS[view]}</span>
          </nav>
        )}
        <main id="main-content" tabIndex={-1} className="mt-8 flex-1 outline-none">
          {view === "focus" && (
            <FocusView method={method} methodId={methodId} setMethodId={setMethodId} timer={timer} theme={theme}
              tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask} toggleTask={toggleTask}
              custom={custom} setCustom={setCustom}
              isPremium={isPremium} gateThen={gateThen}
              exams={examSchedules} addExam={addExam} editExam={editExam} removeExam={removeExam}
              embed={embed} shownEmbed={shownEmbed} playEmbed={playEmbed}
              onPickService={pickDockService} runSolo={runSolo}
              onOpenTasks={() => setView("tasks")}
              onAdvertise={() => (session ? setShowAd(true) : onSignIn())} onGoPremium={() => setShowUpsell(true)}
              countUp={countUp} onCompleteCountUp={completeCountUp}
              session={session} onSignIn={onSignIn} sounds={sounds}
              enterFocus={() => { setImmersive(true); track("focus_mode_enter"); }}
              companions={petStageNode} showCompanions={showCompanions} petsAsleep={petSleep.asleep} onToggleSleep={toggleSleep}
              dockClosed={dockClosed} onReopenDock={reopenDock}
              onOpenCustomize={() => setShowCustomize(true)}
              pipSupported={personalPipSupported} pipActive={personalPipActive}
              onPopOut={() => openPersonalPip().then((ok) => { if (ok) track("pip_open"); })} onClosePip={closePersonalPip}
              motivation={motivation} onOpenHowItWorks={() => setShowHowItWorks(true)} />
          )}
          {view === "tasks" && (
            <TasksView tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask}
              addTask={addTask} editTask={editTask} setTaskTag={setTaskTag} setTaskEst={setTaskEst} toggleTask={toggleTask} removeTask={removeTask}
              reorderTask={reorderTask} onFocusTask={focusTask}
              session={session} onSignIn={onSignIn} tasksLoaded={tasksLoaded}
              guestLimit={GUEST_TASK_LIMIT}
              profile={profile} addImportedTasks={addImportedTasks} onSubscribe={startCheckout}
              onBuyCredits={() => setView("premium")}
              autoCompleteEstimates={autoCompleteEstimates} onToggleAutoComplete={toggleAutoCompleteEstimates}
              plannedSessions={plannedSessions} onCreatePlan={createStudyPlan} onUpdatePlan={updateStudyPlan} onDeletePlan={deleteStudyPlan} />
          )}
          {view === "analytics" && (
            <div data-tour="analytics">
              <AnalyticsView isPremium={isPremium} onUpsell={() => setShowUpsell(true)} onStartFocus={() => setView("focus")}
                streak={streak} todayMinutes={todayMinutes} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal}
                session={session} onSignIn={onSignIn} sessions={sessions} tasks={tasks}
                studyEvents={studyEvents} plannedSessions={plannedSessions} />
            </div>
          )}
          {/* Rooms stay MOUNTED (just hidden) on other tabs: leaving the tab no
              longer kicks you out of a room — presence, the shared timer, room
              music, chat, and the pop-out keep running while you work on Tasks
              or anywhere else. */}
          <div data-tour="rooms" className={view === "rooms" ? undefined : "hidden"}>
            <RoomsLive session={session} profile={profile} isPremium={isPremium} gateThen={gateThen} onSignIn={onSignIn}
              onNeedUsername={openFriends} onOpenFriends={openFriends}
              targetRoomId={roomTarget} onTargetConsumed={() => setRoomTarget(null)}
              soundAuto={soundAuto} onInRoom={handleInRoom} leaveSignal={leaveSignal}
              completionSoundEnabled={alerts.soundEnabled} onCelebrate={celebrateFocusComplete}
              pipSupported={pipSupported} pipWindow={pipWindow}
              onPopOut={() => openPip({ width: 191, height: 349 }).then((pip) => { if (pip) track("pip_open", "room"); })} onClosePip={closePip}
              onImportedTasks={addImportedTasks as (rows: unknown[]) => void} onUpgrade={startCheckout} />
          </div>
          {view === "garden" && (
            <div data-tour="garden">
              {session ? (
                <GamificationView gamification={gamification} session={session} reduceMotion={a11y.reduceMotion}
                  onSignIn={onSignIn} onToggle={onToggleCompanion}
                  companionsOn={companionsOn} onToggleCompanions={toggleCompanions} />
              ) : (
                <GardenLock onSignIn={onSignIn} />
              )}
            </div>
          )}
          {view === "premium" && (
            <PremiumView isPremium={isPremium} session={session} profile={profile} onSubscribe={startCheckout}
              checkoutLoading={checkoutLoading} checkoutError={checkoutError} />
          )}
          {view === "admin" && <AdminView isAdmin={isAdmin} />}
        </main>
        <footer className="mt-12 text-center text-xs text-muted-foreground">
          © 2026 Roamly Flow ·{" "}
          {/* Real anchor so crawlers can reach the public landing page; it is a
              standalone static route, so a full navigation (not client routing)
              is intended here. */}
          <a href="/pomodoro-timer" className="underline-offset-2 transition hover:text-foreground hover:underline">
            Pomodoro timer
          </a>{" "}
          ·{" "}
          <button onClick={() => setShowHelpLegal(true)} className="underline-offset-2 transition hover:text-foreground hover:underline">
            Help &amp; Legal
          </button>
        </footer>
      </div>
      <BottomNav nav={nav} view={view} setView={setView} />
      {/* Above the focus-mode overlay (z-120) and modals; pointer-events none. */}
      <ConfettiBurst burst={confettiBurst} reduceMotion={a11y.reduceMotion} enabled={confettiOn} />
      {/* Not mounted at all until music is intentional — mounting would load a
          streaming iframe on first page load. Once mounted, hiding is CSS-only
          so playback survives tab switches. */}
      {(embed !== null || !dockClosed) && (
        <MusicDock shown={shownEmbed} minimized={dockMin} onToggleMin={toggleDockMin} onPickService={pickDockService} onClose={closeDock}
          hidden={view !== "focus" || immersive || !!pipWindow || dockClosed}
          stopSignal={embedStopSignal} onPlaying={onEmbedPlaying} />
      )}
      <FocusMode open={immersive} phase={timer.phase}
        phaseLabel={timer.phase === "focus" ? "Focus" : timer.phase === "short" ? "Short break" : "Long break"}
        timeText={fmt(timer.secondsLeft)} progress={timer.progress}
        title={tasks.find((t) => t.id === activeTask)?.title} subtitle={method.name}
        cycles={method.cycles} completed={timer.completedFocus}
        ring={timer.phase === "focus" ? theme.ring : theme.rest}
        onExit={() => setImmersive(false)}
        controls={
          <>
            <button onClick={() => { if (timer.running) { timer.pause(); return; } runSolo(() => { countUp.reset(); unlockAudio(); timer.start(); }); }}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl px-8 font-semibold text-white shadow-glow transition active:scale-[0.98]"
              style={{ background: timer.phase === "focus" ? theme.ring : theme.rest }} aria-label={timer.running ? "Pause" : "Resume"}>
              {timer.running ? <><Pause size={20} fill="currentColor" /> Pause</> : <><Play size={20} fill="currentColor" /> Resume</>}
            </button>
            <button onClick={timer.skip} className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground" aria-label="Skip">
              <SkipForward size={18} />
            </button>
            {/* Pets-sleep chip, always visible so pets can be brought back; the
                rest of the settings (auto-flow, pets, confetti, pop-out,
                sound, notifications) live in the shared Customize Session
                drawer — same button and UI as the non-immersive timer. */}
            {showCompanions && (
              <button onClick={toggleSleep} aria-pressed={petSleep.asleep}
                className={`flex h-12 items-center gap-1.5 rounded-2xl border px-4 text-xs font-medium transition ${petSleep.asleep ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
                <Moon size={14} /> {petSleep.asleep ? "Wake pets" : "Too distracting"}
              </button>
            )}
            {personalPipSupported && (
              <button onClick={() => { setImmersive(false); openPersonalPip().then((ok) => { if (ok) track("pip_open", "from_focus"); }); }}
                className="flex h-12 items-center gap-1.5 rounded-2xl border border-border bg-card px-4 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                <PictureInPicture2 size={14} /> Pop out timer
              </button>
            )}
            <button onClick={() => setShowCustomize(true)}
              className="flex h-12 items-center gap-1.5 rounded-2xl border border-border bg-card px-4 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
              <Settings2 size={14} /> Customize Session
            </button>
          </>
        }
        companions={petStageNode}
        motivation={timer.phase === "focus" ? motivation : null}
        extra={
          // Order per user feedback: 1) Tasks, 2) built-in Music, 3) the
          // Spotify/Apple embed — so the two music boxes sit together under the
          // task list. The built-in sounds keep the same card styling the
          // FocusMode `music` slot gave them.
          <div className="space-y-4">
            <AdBreakPrompt active={timer.phase !== "focus" && !isPremium}
              onAdvertise={() => (session ? setShowAd(true) : onSignIn())} onGoPremium={() => setShowUpsell(true)} />
            {/* During breaks the checklist itself carries the optional green
                break tasks, so no separate break card is needed here. */}
            <FocusTasksCard tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask} toggleTask={toggleTask}
              estimateReachedTask={estimateReachedTask} onResolveEstimate={resolveEstimateReached}
              breakActive={timer.phase !== "focus"} breakKey={`solo-${timer.phase}-${timer.completedFocus}`} />
            {/* One music panel: built-in Focus sounds on top, then Spotify and
                Apple — same layout as the non-immersive Focus tab. */}
            <MusicPanel embed={embed} service={dockService} onServiceChange={pickDockService} onPlay={playEmbed} sounds={sounds} />
          </div>
        } />
      {/* Shared Customize Session drawer — opened from the normal timer's button
          AND the immersive focus-mode controls, so both surfaces use the exact
          same button and UI. Renders above the focus overlay (drawer z-130 >
          overlay z-120). */}
      {showCustomize && (
        <CustomizeSession onClose={() => setShowCustomize(false)}
          companionsOn={companionsOn} onToggleCompanions={toggleCompanions}
          confettiOn={confettiOn} onToggleConfetti={toggleConfetti}
          autoFlow={autoFlow} onToggleAutoFlow={toggleAutoFlow}
          alerts={alerts} />
      )}
      {/* Picture-in-Picture floating timer for the PERSONAL timer. Portaled from
          App (not FocusView) so it survives tab switches and shares the one live
          `timer` object. Yields to the room's own pop-out while a room is open. */}
      {pipWindow && !roomActive && createPortal(
        <PipTimer
          phaseLabel={timer.phase === "focus" ? "Focus" : timer.phase === "short" ? "Short break" : "Long break"}
          ring={timer.phase === "focus" ? theme.ring : theme.rest}
          timeText={fmt(timer.secondsLeft)} progress={timer.progress}
          taskTitle={tasks.find((t) => t.id === activeTask)?.title}
          controls={
            <>
              <button onClick={() => { if (timer.running) timer.pause(); else { countUp.reset(); timer.start(); } }}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-semibold text-white shadow-glow transition active:scale-[0.98]"
                style={{ background: timer.phase === "focus" ? theme.ring : theme.rest }} aria-label={timer.running ? "Pause" : "Resume"}>
                {timer.running ? <><Pause size={18} fill="currentColor" /> Pause</> : <><Play size={18} fill="currentColor" /> Resume</>}
              </button>
              <button onClick={timer.skip}
                className="grid h-11 w-11 place-items-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                aria-label="Skip"><SkipForward size={16} /></button>
            </>
          }
          extra={embed ? <StreamingPlayer shown={embed} compact plain stopSignal={embedStopSignal} /> : undefined} />,
        pipWindow.document.body
      )}
      {/* The pop-out is a separate document, so the main confetti canvas can't
          reach it. Mount a second burst pointed at the PiP window, driven by
          the same counter, so a focus block that finishes while the user is
          watching the pop-out still celebrates there. Not gated on roomActive:
          the personal and room pop-outs share this one window, and rooms bump
          the same counter, so this covers both. */}
      {pipWindow && createPortal(
        <ConfettiBurst burst={confettiBurst} reduceMotion={a11y.reduceMotion} enabled={confettiOn} win={pipWindow} />,
        pipWindow.document.body
      )}
      {confirmDialog && (
        <ConfirmModal title={confirmDialog.title} body={confirmDialog.body} confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm} onClose={() => setConfirmDialog(null)} />
      )}
      {showUpsell && <Upsell onClose={() => setShowUpsell(false)} onUpgrade={() => { setShowUpsell(false); startCheckout(); }}
        onBuyCredits={() => { setShowUpsell(false); setView("premium"); }} />}
      {showAuth && <AuthPanel onClose={() => setShowAuth(false)} />}
      {gamPopup && <UnlockToast result={gamPopup} onClose={() => setGamPopup(null)} />}
      {needsPassword && session && (
        <SetPasswordModal onDone={() => {
          setNeedsPassword(false);
          history.replaceState(null, "", window.location.pathname);
        }} />
      )}
      {showFriends && session && (
        <FriendsModal session={session} profile={profile} onClose={() => setShowFriends(false)} onUsernameSet={handleUsernameSet}
          isPremium={isPremium} onUpgrade={() => { setShowFriends(false); setShowUpsell(true); }} />
      )}
      {showAccount && session && (
        <AccountSettings session={session} profile={profile} isPremium={isPremium}
          onProfileChange={setProfile} onClose={() => setShowAccount(false)} onSignOut={onSignOut}
          onOpenPremium={() => { setShowAccount(false); setView("premium"); }}
          onOpenFriends={() => { setShowAccount(false); setShowFriends(true); }} />
      )}
      {showSettings && (
        <SettingsModal a11y={a11y} setA11y={setA11y}
          onReplayTutorial={() => setShowTutorial(true)} onClose={() => setShowSettings(false)} />
      )}
      {/* Deferred while a password prompt from an email link is up. */}
      {showTutorial && !needsPassword && <Tutorial setView={setView} returnView={tourReturnView} onClose={() => setShowTutorial(false)} />}
      {showHowItWorks && (
        <HowItWorksModal onClose={() => setShowHowItWorks(false)}
          onStartTour={() => { setShowHowItWorks(false); openTutorial(); }} />
      )}
      {showFeedback && session && (
        <FeedbackModal userId={session.user.id} page={view} onClose={() => setShowFeedback(false)} />
      )}
      {showHelpLegal && (
        <HelpLegal onClose={() => setShowHelpLegal(false)}
          onOpenHowItWorks={() => setShowHowItWorks(true)}
          onOpenTour={openTutorial}
          onOpenFeedback={() => (session ? setShowFeedback(true) : setShowAuth(true))} />
      )}
      {showAd && session && (
        <AdSubmitModal userId={session.user.id} onClose={() => setShowAd(false)} />
      )}
    </div>
  );
}

// Slim banner while the device reports itself offline — so a failed sync reads
// as "you're offline" instead of the app silently showing stale/empty data.
// Signed-out demo mode works fully offline, so this is purely informational.
function OfflineBanner() {
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
      <BellOff size={13} /> You're offline. New account changes may not be saved until you reconnect.
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

function Header({ isPremium, streak, session, profile, onSignIn, onSignOut, onOpenAccount, onOpenRoom, onOpenFriends, onOpenPlannedStudy, onOpenPremium, isAdmin, onOpenAdmin, onOpenSettings, themeId, setThemeId, theme, onGoHome, onOpenFeedback }: any) {
  // Single row on every screen size: the avatar (with the profile menu behind
  // it) is always pinned to the top right. Plan status and sign out live
  // inside the menu instead of loose header chips.
  return (
    <header className="flex items-center justify-between gap-1.5 sm:gap-3">
      <button onClick={onGoHome} aria-label="Go to the Focus home screen"
        className="flex shrink-0 items-center gap-2.5 rounded-lg transition hover:opacity-80">
        {/* The original timer mark (matches the app icon / favicon): a dark
            rounded square with a dashed ring and center dot. The ring + dot
            use the active theme's accent so the logo recolors with the site
            theme. */}
        <svg aria-hidden="true" viewBox="0 0 32 32" className="h-9 w-9 shrink-0 sm:h-10 sm:w-10">
          <rect width="32" height="32" rx="7" fill="#16181D" />
          <circle cx="16" cy="16" r="9" fill="none" stroke={theme.ring} strokeWidth="2.5" strokeDasharray="42 14" strokeLinecap="round" />
          <circle cx="16" cy="16" r="2.5" fill={theme.ring} />
        </svg>
        <span className="font-display text-xl font-semibold tracking-tight text-gradient sm:text-2xl">Roamly Flow</span>
      </button>
      <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
        <span className="hidden sm:block"><StreakBadge streak={streak} /></span>
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
          <button onClick={onOpenPremium} aria-label="Premium plans"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full gradient-primary font-semibold text-white shadow-glow transition active:scale-95 sm:flex sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs">
            <Crown size={15} /> <span className="hidden sm:inline">Premium</span>
          </button>
        )}
        {!session && (
          <button onClick={onSignIn} aria-label="Sign in" className="grid h-9 w-9 shrink-0 place-items-center rounded-full gradient-primary font-semibold text-white shadow-glow transition active:scale-95 sm:flex sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs">
            <LogIn size={15} /> <span className="hidden sm:inline">Sign in</span>
          </button>
        )}
        <ProfileMenu session={session} profile={profile} isPremium={isPremium}
          onSignIn={onSignIn} onSignOut={onSignOut} onOpenAccount={onOpenAccount} onOpenPremium={onOpenPremium} onOpenFriends={onOpenFriends}
          isAdmin={isAdmin} onOpenAdmin={onOpenAdmin} onOpenSettings={onOpenSettings} onSendFeedback={onOpenFeedback} />
      </div>
    </header>
  );
}

function SignInPrompt({ onSignIn, message }: any) {
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
function GardenLock({ onSignIn }: { onSignIn: () => void }) {
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

// Local-time YYYY-MM-DD (not toISOString, which is UTC and can be a day off).
function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseLocalDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

function localDateValue(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function ThemedDatePicker({ value, min, onChange }: { value: string; min?: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = parseLocalDate(value);
  const today = new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(selected?.year ?? today.getFullYear(), selected?.month ?? today.getMonth(), 1));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    const nextSelected = parseLocalDate(value);
    if (nextSelected) setVisibleMonth(new Date(nextSelected.year, nextSelected.month, 1));
  }, [value]);

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const leading = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const display = selected
    ? new Date(selected.year, selected.month, selected.day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "Choose exam date";

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-label="Exam date" aria-haspopup="dialog" aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground transition hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30">
        <span className={selected ? "truncate" : "truncate text-muted-foreground"}>{display}</span>
        <CalendarClock size={16} className="shrink-0 text-primary" />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose exam date"
          className="absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-3rem))] rounded-2xl border border-border bg-card p-4 text-foreground shadow-xl">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setVisibleMonth(new Date(year, month - 1, 1))} aria-label="Previous month"
              className="grid h-8 w-8 place-items-center rounded-full border border-border bg-background/50 text-muted-foreground transition hover:border-primary/50 hover:text-primary">
              <ChevronLeft size={16} />
            </button>
            <span className="font-display text-sm font-semibold">{visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <button type="button" onClick={() => setVisibleMonth(new Date(year, month + 1, 1))} aria-label="Next month"
              className="grid h-8 w-8 place-items-center rounded-full border border-border bg-background/50 text-muted-foreground transition hover:border-primary/50 hover:text-primary">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: leading }, (_, index) => <span key={`blank-${index}`} />)}
            {Array.from({ length: dayCount }, (_, index) => {
              const day = index + 1;
              const dateValue = localDateValue(year, month, day);
              const chosen = selected?.year === year && selected.month === month && selected.day === day;
              const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
              const disabled = !!min && dateValue < min;
              return <button key={day} type="button" disabled={disabled} onClick={() => { onChange(dateValue); setOpen(false); }} aria-pressed={chosen}
                className={`grid h-9 place-items-center rounded-xl text-sm transition ${chosen ? "gradient-primary font-semibold text-white shadow-glow" : isToday ? "border border-primary/50 bg-primary/10 font-semibold text-primary" : "hover:bg-primary/10 hover:text-primary"} disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-foreground`}>
                {day}
              </button>;
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <button type="button" onClick={() => {
                setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                onChange(localDateValue(today.getFullYear(), today.getMonth(), today.getDate()));
                setOpen(false);
              }} className="rounded-full px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10">Today</button>
              <button type="button" onClick={() => onChange("")} className="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-background/60">Clear</button>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full gradient-primary px-4 py-1.5 text-xs font-semibold text-white shadow-glow">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// The board exams PA (and med) students most often count down to. "Custom…"
// covers everything else (shelf exams, finals, quizzes) with a free-text name.
const EXAM_OPTIONS = [
  "PANCE", "PANRE", "PACKRAT", "EOR (End of Rotation)",
  "Family Medicine EOR", "Internal Medicine EOR", "Emergency Medicine EOR",
  "General Surgery EOR", "Pediatrics EOR", "Psychiatry EOR", "Women's Health EOR",
  "USMLE Step 1", "USMLE Step 2 CK", "USMLE Step 3",
  "COMLEX Level 1", "COMLEX Level 2-CE", "COMLEX Level 3",
  "MCAT", "NCLEX-RN", "NCLEX-PN", "DAT", "GRE", "LSAT", "Bar Exam", "CPA Exam",
];

function ExamSchedulePanel({ exams, onCreate, onUpdate, onDelete }: {
  exams: ExamSchedule[];
  onCreate: (name: string, date: string) => Promise<boolean>;
  onUpdate: (id: string, name: string, date: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draftDate, setDraftDate] = useState("");
  const [examPick, setExamPick] = useState("PANCE");
  const [customName, setCustomName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExamSchedule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const todayStr = localTodayISO();
  const sorted = [...exams].sort((a, b) => a.exam_date.localeCompare(b.exam_date));
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const resetDraft = () => {
    setEditingId(null);
    setDraftDate("");
    setExamPick("PANCE");
    setCustomName("");
    setMessage(null);
  };
  const startNew = () => {
    setDraftDate("");
    setExamPick("PANCE");
    setCustomName("");
    setMessage(null);
    setEditingId("new");
  };
  const startEdit = (exam: ExamSchedule) => {
    const listed = EXAM_OPTIONS.includes(exam.name);
    setDraftDate(exam.exam_date);
    setExamPick(listed ? exam.name : "custom");
    setCustomName(listed ? "" : exam.name);
    setMessage(null);
    setEditingId(exam.id);
  };
  const save = async () => {
    if (!draftDate || draftDate < todayStr) return;
    const name = examPick === "custom" ? customName.trim().slice(0, 60) : examPick;
    if (!name) {
      setMessage("Enter a name for this exam.");
      return;
    }
    setSaving(true);
    const saved = editingId === "new"
      ? await onCreate(name, draftDate)
      : editingId ? await onUpdate(editingId, name, draftDate) : false;
    setSaving(false);
    if (saved) resetDraft();
    else setMessage("Couldn't save that exam. Try again.");
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    if (!await onDelete(deleteTarget.id)) {
      setDeleteError("Couldn't delete that exam. Try again.");
      setDeleting(false);
      return;
    }
    if (editingId === deleteTarget.id) resetDraft();
    setDeleting(false);
    setDeleteTarget(null);
  };

  return (
    <section data-exam-panel className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock size={16} className="text-primary" /> Exam schedule
            <InfoTip text="Track as many board exams, rotation exams, finals, or custom tests as you need. Roamly Flow orders them by date and keeps a live countdown for each one." />
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Keep every upcoming test and countdown together.</p>
        </div>
        {editingId !== "new" && (
          <button onClick={startNew} className="flex items-center gap-1.5 rounded-full gradient-primary px-3 py-1.5 text-xs font-semibold text-white shadow-glow">
            <Plus size={13} /> Add exam
          </button>
        )}
      </div>

      {editingId && (
        <Modal label={editingId === "new" ? "Add an exam" : "Edit exam"} onClose={resetDraft}
          cardClassName="w-full max-w-xl rounded-3xl border border-border bg-card p-6 shadow-xl">
          <div className="grid h-11 w-11 place-items-center rounded-2xl gradient-primary text-white shadow-glow"><CalendarClock size={20} /></div>
          <h3 className="mt-4 font-display text-xl font-semibold">{editingId === "new" ? "Add an exam" : "Edit exam"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">Choose the exam and date Roamly Flow should track.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 gap-2">
              <ThemedSelect value={examPick} onChange={setExamPick} ariaLabel="Which exam" className="flex-1"
                options={[...EXAM_OPTIONS.map((name) => ({ value: name, label: name })), { value: "custom", label: "Custom…" }]} />
              {examPick === "custom" && (
                <input value={customName} onChange={(event) => setCustomName(event.target.value)} maxLength={60}
                  aria-label="Custom exam name" placeholder="Exam name"
                  className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
              )}
            </div>
            <ThemedDatePicker value={draftDate} min={todayStr} onChange={setDraftDate} />
            <div className="flex items-center gap-2 sm:col-span-2">
              <button onClick={resetDraft} className="flex-1 rounded-full border border-border bg-card py-2.5 text-sm text-muted-foreground transition hover:border-primary/40">Cancel</button>
              <button onClick={save} disabled={saving || !draftDate || draftDate < todayStr || (examPick === "custom" && !customName.trim())}
                className="flex-1 rounded-full gradient-primary px-4 py-2.5 text-sm font-semibold text-white shadow-glow disabled:opacity-40">
                {saving ? "Saving…" : editingId === "new" ? "Add" : "Save"}
              </button>
            </div>
          </div>
          {draftDate && draftDate < todayStr && <p className="mt-1.5 text-xs text-destructive">Pick today or a future date.</p>}
          {message && <p className="mt-1.5 text-xs text-destructive">{message}</p>}
        </Modal>
      )}
      {message && !editingId && <p className="mt-2 text-xs text-destructive">{message}</p>}

      {sorted.length === 0 && editingId !== "new" && <p className="mt-3 text-sm text-muted-foreground">No exams scheduled yet.</p>}
      {sorted.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {sorted.map((exam, index) => {
            const examDay = new Date(`${exam.exam_date}T00:00:00`);
            const days = calendarDayNumber(examDay) - calendarDayNumber(today);
            return (
              <article key={exam.id} className={`rounded-xl border p-3 ${index === 0 && days >= 0 ? "border-primary/45 bg-primary/5" : "border-border bg-card/60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{exam.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{examDay.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => startEdit(exam)} aria-label={`Edit ${exam.name}`} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"><Pencil size={13} /></button>
                    <button onClick={() => { setDeleteError(null); setDeleteTarget(exam); }} aria-label={`Delete ${exam.name}`} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={13} /></button>
                  </div>
                </div>
                <p className="mt-2 text-sm">
                  {days > 0 && <><span className="font-display text-xl font-semibold text-primary">{days}</span> day{days === 1 ? "" : "s"} remaining</>}
                  {days === 0 && <span className="font-semibold text-primary">Today. You've got this!</span>}
                  {days < 0 && <span className="text-muted-foreground">Exam date passed</span>}
                </p>
              </article>
            );
          })}
        </div>
      )}
      {deleteTarget && (
        <Modal label="Delete exam" onClose={() => { if (!deleting) setDeleteTarget(null); }}
          cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-destructive/10 text-destructive"><Trash2 size={20} /></div>
          <h3 className="mt-4 font-display text-xl font-semibold">Delete {deleteTarget.name}?</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">This removes the exam date and countdown from your schedule.</p>
          {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}
          <div className="mt-5 flex gap-2">
            <button onClick={() => setDeleteTarget(null)} disabled={deleting}
              className="flex-1 rounded-full border border-border bg-card py-2.5 text-sm text-muted-foreground transition hover:border-primary/40 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={confirmDelete} disabled={deleting}
              className="flex-1 rounded-full bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground transition active:scale-95 disabled:opacity-50">
              {deleting ? "Deleting…" : "Delete exam"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

// The expanded "What's the Pomodoro method?" explanation. The trigger lives in
// the top-right of the FocusIntro heading; this renders below it when opened.
function PomodoroExplainerPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-3 rounded-2xl border border-dashed border-border bg-card/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><HelpCircle size={15} className="text-primary" /> What's the Pomodoro method?</h2>
        <button onClick={onClose} className="shrink-0 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">Got it</button>
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

function FocusView({ method, methodId, setMethodId, timer, theme, tasks, activeTask, setActiveTask, toggleTask, custom, setCustom, isPremium, gateThen, exams, addExam, editExam, removeExam, session, onSignIn, sounds, enterFocus, embed, shownEmbed, playEmbed, onPickService, runSolo, onOpenTasks, onAdvertise, onGoPremium, countUp, onCompleteCountUp, companions, showCompanions, petsAsleep, onToggleSleep, dockClosed, onReopenDock, onOpenCustomize, pipSupported, pipActive, onPopOut, onClosePip, motivation, onOpenHowItWorks }: any) {
  const phaseLabel = timer.phase === "focus" ? "Focus" : timer.phase === "short" ? "Short break" : "Long break";
  const task = tasks.find((t: Task) => t.id === activeTask);
  const ring = timer.phase === "focus" ? theme.ring : theme.rest;
  const timerRef = useRef<HTMLElement>(null);
  const scrollToTimer = () => timerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const [showMethods, setShowMethods] = useState(false);
  // One timer card, two modes: the classic countdown methods or the count-up
  // stopwatch, both picked from the same "Select timer" list.
  const [timerMode, setTimerModeState] = useState<"pomodoro" | "countup">(() => (loadPref("roamly-timer-mode") === "countup" ? "countup" : "pomodoro"));
  const setTimerMode = (m: "pomodoro" | "countup") => {
    if (m === timerMode) return;
    if (timerMode === "pomodoro" && timer.running) timer.pause();
    if (timerMode === "countup" && countUp.running) countUp.pause();
    setTimerModeState(m);
    savePref("roamly-timer-mode", m);
  };
  // "Up next" can be narrowed to one subject; the pick sticks across visits.
  const [upNextTag, setUpNextTagState] = useState<string>(() => loadPref("roamly-upnext-tag") ?? "all");
  const setUpNextTag = (t: string) => { setUpNextTagState(t); savePref("roamly-upnext-tag", t); };
  const upNextTags: string[] = [...new Set<string>(tasks.filter((t: Task) => !t.done).map((t: Task) => t.tag))];
  const activeUpNextTag = upNextTag !== "all" && !upNextTags.includes(upNextTag) ? "all" : upNextTag;

  return (
    <div className="space-y-8">
      <FocusIntro onOpenHowItWorks={onOpenHowItWorks} />

      {/* Exam dates sit above the timer so the countdown to the next exam is
          the first thing a signed-in student sees. */}
      {session && <ExamSchedulePanel exams={exams} onCreate={addExam} onUpdate={editExam} onDelete={removeExam} />}

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
                role="progressbar" aria-label={`${phaseLabel} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(timer.progress * 100)}>
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
            {/* Quick controls only — Focus mode, pop-out, and Customize Session.
                Everything else (auto-flow, completion sound, pets, confetti,
                notifications) lives in the Customize Session drawer so the
                timer stays the dominant element. */}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => enterFocus?.()}
                className="flex items-center gap-1.5 self-start rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/15">
                <Timer size={13} /> Focus mode
              </button>
              <InfoTip text="Focus mode fills your whole screen with the timer, your music, and your task list. Start opens it automatically, and this button gets you back in." />
              {pipSupported && (
                <button onClick={() => (pipActive ? onClosePip?.() : onPopOut?.())} aria-pressed={pipActive}
                  className={`flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition ${pipActive ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
                  <PictureInPicture2 size={13} /> {pipActive ? "Close pop-out" : "Pop out timer"}
                </button>
              )}
              {showCompanions && (
                <button onClick={onToggleSleep} aria-pressed={petsAsleep}
                  className={`flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition ${petsAsleep ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
                  <Moon size={13} /> {petsAsleep ? "Wake pets" : "Too distracting"}
                </button>
              )}
              <button onClick={onOpenCustomize}
                className="flex items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                <Settings2 size={13} /> Customize Session
              </button>
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

      {!session && <GuestSavePrompt onSignIn={onSignIn} />}

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
              // Start a focus session connected to a task (or none) — same
              // gesture-safe path as the main Start button.
              const startFocusing = (taskId: string | null) => {
                setActiveTask(taskId);
                if (timerMode === "countup") {
                  if (!countUp.running) runSolo?.(() => { timer.reset(); unlockAudio(); countUp.start(); });
                  return;
                }
                if (!timer.running) runSolo?.(() => { countUp.reset(); unlockAudio(); enterFocus?.(); timer.start(); });
              };
              if (upNext.length === 0) return (
                <div className="rounded-xl border border-dashed border-border bg-card/50 p-4 text-center">
                  <p className="text-sm font-medium">What are you focusing on today?</p>
                  <p className="mt-1 text-sm text-muted-foreground">Add a task to connect your study time to something you want to complete.</p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <button onClick={onOpenTasks}
                      className="inline-flex items-center gap-1.5 rounded-full gradient-primary px-4 py-2 text-xs font-semibold text-white shadow-glow transition active:scale-95">
                      <Plus size={13} /> Add a task
                    </button>
                    <button onClick={() => startFocusing(null)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                      Start without a task
                    </button>
                  </div>
                </div>
              );
              return upNext.map((t: Task) => (
              <div key={t.id}
                className={`flex w-full items-center gap-2 rounded-xl border p-3 transition ${activeTask === t.id ? "border-primary bg-primary/5" : "border-border bg-card/70 hover:border-primary/40"}`}>
                <button onClick={() => setActiveTask(t.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  aria-label={`Focus on ${t.title}`}>
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
                <button onClick={() => startFocusing(t.id)} aria-label={`Start this task: ${t.title}`} title="Start this task"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary">
                  <Play size={15} />
                </button>
                <button onClick={() => toggleTask(t.id)} aria-label={`Mark complete: ${t.title}`} title="Mark complete"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-roamly-green">
                  <CircleCheck size={15} />
                </button>
              </div>
              ));
            })()}
          </div>
        </div>
      </div>

      <MusicPanel embed={embed} service={shownEmbed.service} onServiceChange={onPickService} onPlay={playEmbed}
        dockClosed={dockClosed} onReopenDock={onReopenDock} sounds={sounds} />
    </div>
  );
}

// Short product explanation above the timer — enough for a first-time visitor
// to know what this is, small enough that the timer stays visible without
// scrolling on phones. The link opens the full "How Roamly Flow works" modal.
function FocusIntro({ onOpenHowItWorks }: { onOpenHowItWorks: () => void }) {
  const [pomOpen, setPomOpen] = useState(false);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold sm:text-2xl">The Pomodoro method built for PA school.</h1>
          <p className="mt-1 text-sm text-muted-foreground">Plan what to study, stay focused, and track your progress toward upcoming exams.</p>
          <button onClick={onOpenHowItWorks}
            className="mt-1.5 text-xs font-medium text-primary underline-offset-2 transition hover:underline">
            How Roamly Flow works
          </button>
        </div>
        {/* The explainer trigger sits in the top-right of the heading; the panel
            opens full-width beneath it. */}
        <button onClick={() => setPomOpen((o) => !o)} aria-expanded={pomOpen} aria-label="What's the Pomodoro method?"
          className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
          <HelpCircle size={13} /> <span className="hidden sm:inline">What's the Pomodoro method?</span>
        </button>
      </div>
      {pomOpen && <PomodoroExplainerPanel onClose={() => setPomOpen(false)} />}
    </div>
  );
}

// Compact, dismissible account prompt below the timer for guests. The basic
// timer needs no account — this only pitches saving progress. Dismissal
// persists on the device; signed-in users never see it.
function GuestSavePrompt({ onSignIn }: { onSignIn: () => void }) {
  const [dismissed, setDismissed] = useState(() => loadPref("roamly-guest-prompt-dismissed") === "1");
  if (dismissed) return null;
  const dismiss = () => { savePref("roamly-guest-prompt-dismissed", "1"); setDismissed(true); };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2.5">
      <span className="min-w-0 flex-1 basis-52 text-sm text-muted-foreground">Save your sessions and track progress toward upcoming exams.</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <button onClick={onSignIn} className="rounded-full gradient-primary px-3.5 py-1.5 text-xs font-semibold text-white shadow-glow transition active:scale-95">
          Create free account
        </button>
        <button onClick={onSignIn} className="rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground">
          Sign in
        </button>
        <button onClick={dismiss} aria-label="Dismiss"
          className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground">
          <X size={14} />
        </button>
      </span>
    </div>
  );
}

// The compact site explanation ("How Roamly Flow works"), opened only from its
// link or Help — never automatically. Ends in the two paths forward: start
// focusing (close) or take the guided tour.
function HowItWorksModal({ onClose, onStartTour }: { onClose: () => void; onStartTour: () => void }) {
  const points: [string, string][] = [
    ["Focus", "Pick a timer method and study in focused blocks with built-in breaks."],
    ["Tasks & exams", "Queue what you'll study by subject and count down to your upcoming exams."],
    ["Progress", "Every finished session lands in your analytics: streaks, goals, and subject breakdowns."],
    ["Rooms", "Join live study rooms and focus alongside other PA students in real time."],
    ["Music", "Built-in soundscapes follow your timer, or connect Spotify and Apple Music."],
    ["Garden", "Earn XP, collect pets, and grow plants as your study time adds up."],
  ];
  return (
    <Modal label="How Roamly Flow works" onClose={onClose}
      cardClassName="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 className="font-display text-lg font-semibold">How Roamly Flow works</h3>
        <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {points.map(([title, body]) => (
          <div key={title}>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">The timer works without an account. A free account adds tasks, exams, rooms, and synced progress.</p>
      </div>
      <div className="flex gap-2 border-t border-border px-5 py-4">
        <button onClick={onClose} className="flex-1 rounded-full gradient-primary py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-95">
          Start focusing
        </button>
        <button onClick={onStartTour} className="flex-1 rounded-full border border-border bg-card py-2.5 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
          Take the quick tour
        </button>
      </div>
    </Modal>
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
function ThemeMenu({ themeId, setThemeId }: any) {
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

// Built-in ambient sounds, free for everyone. Unlike the streaming embeds,
// the app owns this audio, so it can follow the timer perfectly. `bare` drops
// the outer card so it can nest as a section inside the combined Music panel.
function FocusSoundsPanel({ sounds, bare = false }: any) {
  const body = (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-primary" />
          <h2 className="font-display text-lg font-semibold">Focus sounds</h2>
        </div>
        <button onClick={sounds.toggle} disabled={!sounds.sound}
          aria-label={sounds.playing ? "Pause sound" : "Play sound"}
          aria-pressed={sounds.playing}
          className={`grid h-9 w-9 place-items-center rounded-full border transition disabled:opacity-40 ${sounds.playing ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
          {sounds.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FOCUS_SOUNDS.map((s) => {
          const active = sounds.sound === s.id;
          return (
            <button key={s.id} onClick={() => sounds.choose(s.id)} aria-pressed={active}
              className={`relative rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border bg-card/60 hover:border-primary/40"}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{s.name}</span>
                {active && sounds.playing && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.hint}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Play with timer</p>
          <p className="text-[11px] leading-snug text-muted-foreground">Starts on focus, fades out for breaks.</p>
        </div>
        <button role="switch" aria-checked={sounds.auto} aria-label="Play sound with timer" onClick={() => sounds.setAuto(!sounds.auto)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${sounds.auto ? "bg-primary" : "bg-border"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${sounds.auto ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3 px-1">
        <Volume2 size={14} className="shrink-0 text-muted-foreground" />
        <input type="range" min={0} max={1} step={0.05} value={sounds.volume}
          onChange={(e) => sounds.setVolume(Number(e.target.value))}
          aria-label="Sound volume"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-[hsl(var(--primary))]" />
      </div>
      {musicCredit() && <p className="mt-2 px-1 text-[10px] text-muted-foreground">{musicCredit()}</p>}
    </>
  );
  return bare ? body : <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">{body}</div>;
}

// Controller for the ONE persistent streaming player (the mini-dock App
// renders at the root). Selecting a preset or pasting a link hands the target
// up to App via onPlay — the iframe itself lives in the dock, so it keeps
// playing across tab switches and pop-out timers instead of dying when this
// panel unmounts.
function MusicPanel({ embed, service, onServiceChange, onPlay, dockClosed = false, onReopenDock, sounds }: any) {
  const [spotifyCustomUrl, setSpotifyCustomUrl] = useState("");
  const [spotifyCustomError, setSpotifyCustomError] = useState(false);
  const [appleCustomUrl, setAppleCustomUrl] = useState("");
  const [appleCustomError, setAppleCustomError] = useState(false);
  // Let the whole streaming panel collapse to just its header, to free room for
  // the timer and tasks. The body is only hidden (h-0 + inert), never
  // unmounted, so a playing embed keeps going. The choice persists per device.
  const [collapsed, setCollapsed] = useState(() => loadPref("roamly-focus-music-collapsed") === "1");
  const toggleCollapsed = () => setCollapsed((v) => { savePref("roamly-focus-music-collapsed", v ? "0" : "1"); return !v; });

  const playSpotify = (target: { type: SpotifyEmbedType; id: string }, label: string) =>
    onPlay({ service: "spotify", src: toSpotifyEmbedSrc(target), height: embedHeight(target.type), label });
  const playApple = (target: { type: AppleMusicEmbedType; path: string }, label: string) =>
    onPlay({ service: "apple", src: toAppleEmbedSrc(target), height: appleEmbedHeight(target.type), label });

  const applySpotifyUrl = (value: string) => {
    setSpotifyCustomUrl(value);
    if (!value.trim()) { setSpotifyCustomError(false); return; }
    const parsed = parseSpotifyUrl(value);
    if (parsed) { setSpotifyCustomError(false); playSpotify(parsed, "Your Spotify pick"); }
    else setSpotifyCustomError(true);
  };

  const applyAppleUrl = (value: string) => {
    setAppleCustomUrl(value);
    if (!value.trim()) { setAppleCustomError(false); return; }
    const parsed = parseAppleMusicUrl(value);
    if (parsed) { setAppleCustomError(false); playApple(parsed, "Your Apple Music pick"); }
    else setAppleCustomError(true);
  };

  return (
    <div className="relative rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className={`flex items-center justify-between ${collapsed ? "" : "mb-3"}`}>
        <div className="flex items-center gap-2">
          <Music size={16} className="text-primary" />
          <h2 className="font-display text-lg font-semibold">Music</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {dockClosed && onReopenDock && (
            <button onClick={onReopenDock}
              className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/15">
              Show mini-player
            </button>
          )}
          <button onClick={toggleCollapsed} aria-expanded={!collapsed} aria-controls="focus-music-body"
            aria-label={collapsed ? "Expand Music" : "Collapse Music"}
            className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* Hidden (not unmounted) when collapsed, so a playing embed keeps going. */}
      <div id="focus-music-body" className={collapsed ? "h-0 overflow-hidden" : ""} inert={collapsed} aria-hidden={collapsed}>
        {/* Focus sounds first, then the streaming services below. */}
        {sounds && (
          <div className="mb-4 border-b border-border pb-4">
            <FocusSoundsPanel sounds={sounds} bare />
          </div>
        )}
        <div className="mb-3 flex gap-1.5 rounded-xl border border-border bg-card/60 p-1">
          <button onClick={() => onServiceChange("spotify")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${service === "spotify" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            Spotify
          </button>
          <button onClick={() => onServiceChange("apple")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${service === "apple" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            Apple Music
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(service === "spotify" ? SPOTIFY_PRESETS : APPLE_MUSIC_PRESETS).map((p: any) => {
            const src = service === "spotify"
              ? toSpotifyEmbedSrc({ type: p.type, id: p.spotifyId })
              : toAppleEmbedSrc({ type: p.type, path: p.path });
            const active = embed?.src === src;
            return (
              <button key={p.id}
                onClick={() => (service === "spotify" ? playSpotify({ type: p.type, id: p.spotifyId }, p.name) : playApple({ type: p.type, path: p.path }, p.name))}
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
          <label htmlFor={`${service}-url`} className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Or paste a {service === "spotify" ? "Spotify" : "Apple Music"} link
          </label>
          <input id={`${service}-url`} type="text"
            value={service === "spotify" ? spotifyCustomUrl : appleCustomUrl}
            onChange={(e) => (service === "spotify" ? applySpotifyUrl(e.target.value) : applyAppleUrl(e.target.value))}
            placeholder={service === "spotify" ? "https://open.spotify.com/playlist/..." : "https://music.apple.com/us/playlist/..."}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
          {(service === "spotify" ? spotifyCustomError : appleCustomError) && (
            <p className="mt-1.5 text-[11px] text-destructive">
              Couldn't read that link. Paste a track, playlist, album, or artist URL.
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Playlists load into the mini-player at the bottom of your screen. It keeps
          playing while you switch tabs. Minimize it there whenever it's in the way.
        </p>
      </div>
    </div>
  );
}

// The ONE streaming player. Mounted once at App root and never unmounted or
// reparented — an iframe reloads (and stops the music) if it moves in the
// DOM, so tab switches and minimizing only ever toggle CSS on this container.
// Preloaded with a default station so both services are visibly available
// without clicking anything (autoplay can't start without a user gesture).
// The actual player. Spotify goes through the iFrame API (SpotifyEmbed) so the
// app can pause it and detect its play button; Apple Music has no such API, so
// it stays a plain iframe that stopSignal remounts (a reload is the only way
// to silence an uncontrolled embed).
function EmbedPlayer({ shown, height, stopSignal, onPlaying, plain = false }: any) {
  // `plain` skips the API player: the PiP window is a separate document the
  // main-window iFrame API script can't manage.
  const spotifyUri = !plain && shown.service === "spotify" ? embedSrcToUri(shown.src) : null;
  if (spotifyUri) {
    return <SpotifyEmbed key={shown.src} uri={spotifyUri} fallbackSrc={shown.src} height={height}
      pauseSignal={stopSignal ?? 0} onPlay={onPlaying ?? (() => {})} />;
  }
  return (
    <iframe key={`${stopSignal ?? 0}-${shown.src}`} src={shown.src} width="100%" height={height}
      style={{ border: "none" }} title="Music player"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
  );
}

function StreamingPlayer({ shown, compact = false, stopSignal, onPlaying, plain = false }: any) {
  return (
    <div className={`mb-3 overflow-hidden rounded-xl border border-border bg-card/70 ${compact ? "" : "shadow-sm"}`}>
      <p className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        <Music size={12} className="text-primary" />
        <span className="truncate">{shown.service === "spotify" ? "Spotify" : "Apple Music"} · {shown.label}</span>
      </p>
      <EmbedPlayer shown={shown} height={compact ? 96 : Math.min(shown.height, 152)} stopSignal={stopSignal} onPlaying={onPlaying} plain={plain} />
    </div>
  );
}

function MusicDock({ shown, minimized, onToggleMin, onPickService, onClose, hidden = false, stopSignal, onPlaying }: any) {
  return (
    // z-[45]: above the bottom nav (z-40), below every modal (z-50+) — a
    // permanent fixture must never eat taps meant for an open dialog.
    // `inert` while hidden: opacity/pointer-events only hide it visually —
    // without it the controls stay tabbable and announced to screen readers.
    <div data-testid="music-dock" inert={hidden} aria-hidden={hidden}
      className={`fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[45] overflow-hidden rounded-2xl border border-border bg-card shadow-xl transition ${hidden ? "pointer-events-none opacity-0" : "opacity-100"} sm:left-auto sm:right-4 sm:w-96`}>
      <div className="flex items-center">
        <button onClick={onToggleMin} className="flex min-w-0 flex-1 items-center justify-between px-3 py-1.5 text-left"
          aria-label={minimized ? "Expand music player" : "Minimize music player"} aria-expanded={!minimized}>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Music size={12} className="shrink-0 text-primary" />
            <span className="truncate">{shown.service === "spotify" ? "Spotify" : "Apple Music"} · {shown.label}</span>
          </span>
          {minimized ? <ChevronUp size={14} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={14} className="shrink-0 text-muted-foreground" />}
        </button>
        <button onClick={onClose} aria-label="Close music player"
          className="mr-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
          <X size={13} />
        </button>
      </div>
      {/* Collapsed via height, NOT unmounted — the music keeps playing.
          `inert` keeps the collapsed controls out of the tab order too. */}
      <div className={minimized ? "h-0 overflow-hidden" : ""} inert={minimized} aria-hidden={minimized}>
        {/* Switch services without leaving the dock — loads that service's
            default station (the panel's presets still work as before). */}
        <div className="mx-2 mb-1.5 flex gap-1 rounded-lg border border-border bg-card/60 p-0.5">
          {(["spotify", "apple"] as const).map((s) => (
            <button key={s} onClick={() => onPickService?.(s)} aria-pressed={shown.service === s}
              className={`flex-1 rounded-md py-1 text-[11px] font-medium transition ${shown.service === s ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {s === "spotify" ? "Spotify" : "Apple Music"}
            </button>
          ))}
        </div>
        <EmbedPlayer shown={shown} height={Math.min(shown.height, 152)} stopSignal={stopSignal} onPlaying={onPlaying} />
      </div>
    </div>
  );
}

function TagPill({ tag }: { tag: string }) {
  const c = tagColor(tag);
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${c}1f`, color: c }}>
      {tag}
    </span>
  );
}

type DragState = { id: string; group: string; from: number; over: number; dy: number; height: number };

// Themed yes/no dialog, replacing bare window.confirm() pop-ups. onConfirm runs
// on the confirm click (still a user gesture, so iOS audio unlock survives).
function ConfirmModal({ title, body, confirmLabel, onConfirm, onClose }: {
  title: string; body?: string; confirmLabel: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal label={title} onClose={onClose}
      overlayClassName="fixed inset-0 z-[140] grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm"
      cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {body && <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-full border border-border bg-card py-2 text-sm text-muted-foreground transition hover:border-primary/40">Cancel</button>
        <button autoFocus onClick={() => { onConfirm(); onClose(); }}
          className="flex-1 rounded-full gradient-primary py-2 text-sm font-semibold text-white shadow-glow transition active:scale-95">{confirmLabel}</button>
      </div>
    </Modal>
  );
}

// Themed picker opened from a task's subject badge: choose another existing
// subject to move the task into. New subjects are still created through the
// add-task row's "＋ New subject…" flow.
function TaskCategoryModal({ task, tags, onPick, onClose }: {
  task: Task; tags: string[]; onPick: (tag: string) => void; onClose: () => void;
}) {
  return (
    <Modal label="Change subject" onClose={onClose} cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
      <h3 className="font-display text-lg font-semibold">Move to subject</h3>
      <p className="mt-1 truncate text-xs text-muted-foreground">“{task.title}”</p>
      <div className="mt-3 max-h-[50dvh] space-y-1.5 overflow-y-auto overscroll-contain">
        {tags.map((tag) => {
          const current = tag === task.tag;
          const c = tagColor(tag);
          return (
            <button key={tag} onClick={() => { if (!current) onPick(tag); onClose(); }} aria-pressed={current}
              className={`flex min-h-[2.75rem] w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition ${current ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 hover:border-primary/40"}`}>
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />
              <span className="min-w-0 flex-1 break-words">{tag}</span>
              {current && <Check size={15} className="shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Need a new subject? Create it with “＋ New subject…” when adding a task.</p>
    </Modal>
  );
}

function TaskEstModal({ task, onPick, onClose }: any) {
  return (
    <Modal label="Focus sessions needed" onClose={onClose} cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
      <h3 className="font-display text-lg font-semibold">How many focus sessions to complete this task?</h3>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
          <button key={n} onClick={() => { onPick(n); onClose(); }} aria-pressed={task.est === n}
            className={`rounded-xl border py-2.5 font-mono text-sm transition ${task.est === n ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
            {n}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function TasksView({ tasks, activeTask, addTask, editTask, setTaskTag, setTaskEst, toggleTask, removeTask, reorderTask, onFocusTask, session, onSignIn, tasksLoaded, profile, addImportedTasks, onSubscribe, onBuyCredits, guestLimit, autoCompleteEstimates, onToggleAutoComplete, plannedSessions, onCreatePlan, onUpdatePlan, onDeletePlan }: any) {
  const [draft, setDraft] = useState("");
  const [tag, setTag] = useState("");
  const [customTag, setCustomTag] = useState<string | null>(null); // non-null while typing a new subject
  const [estDraft, setEstDraft] = useState(1); // focus sessions for the task being created
  const [showDone, setShowDone] = useState(false);
  const [showTaskPrefs, setShowTaskPrefs] = useState(false);
  // Planned study sits under Task preferences and starts minimized so task
  // creation stays the page's primary action.
  const [showPlanned, setShowPlanned] = useState(false);
  const [estTarget, setEstTarget] = useState<Task | null>(null);   // themed sessions picker
  const [tagPickTarget, setTagPickTarget] = useState<Task | null>(null); // themed subject picker

  // --- Inline title editing (click the task name; Enter saves, Esc cancels) ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const startEdit = (t: Task) => { setEditingId(t.id); setEditDraft(t.title); };
  const cancelEdit = () => setEditingId(null);
  const commitEdit = () => {
    if (!editingId) return;
    const next = editDraft.trim();
    const current = tasks.find((t: Task) => t.id === editingId);
    // An empty title is never saved — the original is restored instead.
    if (next && current && next !== current.title) editTask(editingId, next);
    setEditingId(null);
  };

  // --- Drag reordering (grip handle, or press-and-hold anywhere on the row) ---
  // Grab the ⋮⋮ handle (instant with a mouse, ~0.1s on touch) or hold the row
  // ~0.3s to lift it, drag to a new spot in its subject group, release to
  // drop. A quick tap or an immediate move (scrolling) never triggers the
  // row-body path, and the arrow buttons remain as the accessible alternative.
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  const press = useRef<{ id: string; group: string; groupIds: string[]; index: number; y: number; el: HTMLDivElement; pointerId: number; timer: number; fromHandle: boolean } | null>(null);
  const rects = useRef<{ id: string; mid: number }[]>([]);
  const justDragged = useRef(false);
  // Dragging a row over a *different* subject section reassigns its category on
  // drop (instead of the within-group reorder). Highlight that target section
  // while the finger is over it. The ref is the source of truth (updated
  // synchronously in the move handler) so the release always reads the latest
  // hit-test result; the state only drives the highlight.
  const [dropTag, setDropTag] = useState<string | null>(null);
  const dropTagRef = useRef<string | null>(null);
  const setDropTarget = (next: string | null) => { dropTagRef.current = next; setDropTag(next); };

  const onRowPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string, group: string, groupIds: string[], index: number) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    if (press.current) return;
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    // The grip handle can't scroll the page (touch-action: none), so it lifts
    // near-instantly — and immediately for a mouse, where press-and-hold is an
    // alien gesture. The row body keeps a hold delay so touch scrolling wins.
    const fromHandle = !!(e.target as HTMLElement).closest("[data-drag-handle]");
    const holdMs = fromHandle ? (e.pointerType === "mouse" ? 0 : 120) : 300;
    const timer = window.setTimeout(() => {
      const p = press.current;
      if (!p) return;
      rects.current = p.groupIds.map((gid) => {
        const r = rowRefs.current.get(gid)?.getBoundingClientRect();
        return { id: gid, mid: r ? r.top + r.height / 2 : 0 };
      });
      try { p.el.setPointerCapture(p.pointerId); } catch { /* pointer already gone */ }
      (navigator as any).vibrate?.(10);
      setDrag({ id: p.id, group: p.group, from: p.index, over: p.index, dy: 0, height: p.el.getBoundingClientRect().height });
    }, holdMs);
    press.current = { id, group, groupIds, index, y: e.clientY, el, pointerId, timer, fromHandle };
  };

  const onRowPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const d = dragRef.current;
    if (!d) {
      // Moved before the hold completed → it's a scroll, not a drag. Presses
      // that started on the grip handle can't be scrolls, so they never cancel.
      if (!p.fromHandle && Math.abs(e.clientY - p.y) > 12) { clearTimeout(p.timer); press.current = null; }
      return;
    }
    const dy = e.clientY - p.y;
    const center = rects.current[d.from]?.mid + dy;
    let over = d.from, best = Infinity;
    rects.current.forEach((r, i) => {
      const dist = Math.abs(center - r.mid);
      if (dist < best) { best = dist; over = i; }
    });
    setDrag({ ...d, dy, over });
    // Hit-test the finger against every subject section; over a different one
    // means "drop to move category" rather than "reorder within this one".
    let target: string | null = null;
    for (const [name, el] of groupRefs.current) {
      const r = el.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) { target = name; break; }
    }
    setDropTarget(target && target !== d.group ? target : null);
  };

  const onRowPointerUp = () => {
    const p = press.current;
    const d = dragRef.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    if (d) {
      const target = dropTagRef.current;
      // Dropped over another subject → reassign; otherwise reorder in place.
      if (target && target !== d.group) setTaskTag(d.id, target);
      else if (d.over !== d.from) reorderTask(d.id, d.over);
      justDragged.current = true;
      window.setTimeout(() => { justDragged.current = false; }, 80);
      setDrag(null);
      setDropTarget(null);
    }
  };

  const onRowPointerCancel = () => {
    const p = press.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    if (dragRef.current) { setDrag(null); setDropTarget(null); }
  };

  // While a drag is live, stop the page from scrolling under the finger.
  useEffect(() => {
    if (!drag) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", stop, { passive: false });
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("touchmove", stop);
      document.body.style.userSelect = "";
    };
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const dragStyleFor = (group: string, id: string, index: number): React.CSSProperties | undefined => {
    if (!drag || drag.group !== group) return undefined;
    if (id === drag.id) {
      return { transform: `translateY(${drag.dy}px) scale(1.02)`, zIndex: 20, position: "relative", boxShadow: "0 10px 28px rgba(0,0,0,0.18)", transition: "none" };
    }
    const shift = drag.height + 8; // 8px = space-y-2 gap
    if (index > drag.from && index <= drag.over) return { transform: `translateY(${-shift}px)`, transition: "transform 0.15s ease" };
    if (index < drag.from && index >= drag.over) return { transform: `translateY(${shift}px)`, transition: "transform 0.15s ease" };
    return { transition: "transform 0.15s ease" };
  };

  // No preset subjects: the dropdown offers exactly the subjects the user's
  // own tasks carry. A subject disappears when its last task does.
  const tags: string[] = [...new Set<string>(tasks.map((t: Task) => t.tag))];
  const selectedTag = tags.includes(tag) ? tag : (tags[0] ?? "");
  const noSubjectsYet = tags.length === 0;
  // Free-typed subject input: explicit "＋ New subject…" pick, or forced when
  // there are no subjects at all (very first task).
  const showCustom = customTag !== null || noSubjectsYet;

  const add = () => {
    const chosenTag = showCustom ? (customTag ?? "").trim().slice(0, 24) : selectedTag;
    if (!draft.trim() || !chosenTag || (!session && tasks.length >= guestLimit)) return;
    addTask(draft.trim(), chosenTag, estDraft);
    setDraft("");
    setEstDraft(1);
    if (showCustom) { setTag(chosenTag); setCustomTag(null); }
  };

  const sorted = sortTasks(tasks);
  const open = sorted.filter((t: Task) => !t.done);
  const doneTasks = sorted.filter((t: Task) => t.done);
  const groupNames: string[] = [...new Set<string>(open.map((t: Task) => t.tag))];
  // Subject groups themselves can be reordered — drag the header's ⋮⋮ handle
  // (arrow keys work on it too) — and the order persists on this device.
  // Unlisted subjects keep their natural position.
  const [tagOrder, setTagOrder] = useState<string[]>(() => { try { const value: unknown = JSON.parse(loadPref("roamly-tag-order") ?? "[]"); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } });
  const groupRank = (g: string) => { const i = tagOrder.indexOf(g); return i === -1 ? 1000 + groupNames.indexOf(g) : i; };
  const orderedGroupNames = [...groupNames].sort((a, b) => groupRank(a) - groupRank(b));
  const applyGroupOrder = (next: string[]) => {
    setTagOrder(next);
    savePref("roamly-tag-order", JSON.stringify(next));
  };
  const moveGroup = (g: string, dir: -1 | 1) => {
    const cur = orderedGroupNames.slice();
    const i = cur.indexOf(g); const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    applyGroupOrder(cur);
  };

  // Collapsed subject sections (click a header to toggle); persists per device.
  const [collapsedTags, setCollapsedTags] = useState<string[]>(() => { try { const value: unknown = JSON.parse(loadPref("roamly-collapsed-tags") ?? "[]"); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } });
  const toggleCollapsed = (g: string) => setCollapsedTags((prev) => {
    const next = prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g];
    savePref("roamly-collapsed-tags", JSON.stringify(next));
    return next;
  });

  // --- Drag reordering for whole subject sections (via the header handle) ---
  // Same pointer mechanics as task rows: lift, translate with the pointer,
  // find the nearest section midpoint, drop to commit. Dragging never toggles
  // collapse because the handle is a separate control from the header button.
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const [groupDrag, setGroupDrag] = useState<{ g: string; from: number; over: number; dy: number; height: number } | null>(null);
  const groupDragRef = useRef<typeof groupDrag>(null);
  useEffect(() => { groupDragRef.current = groupDrag; }, [groupDrag]);
  const groupPress = useRef<{ g: string; index: number; y: number; el: HTMLElement; pointerId: number; timer: number } | null>(null);
  const groupRects = useRef<{ g: string; mid: number }[]>([]);

  const onGroupHandleDown = (e: React.PointerEvent<HTMLButtonElement>, g: string, index: number) => {
    if (groupPress.current) return;
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const holdMs = e.pointerType === "mouse" ? 0 : 120;
    const timer = window.setTimeout(() => {
      const p = groupPress.current;
      if (!p) return;
      groupRects.current = orderedGroupNames.map((name) => {
        const r = groupRefs.current.get(name)?.getBoundingClientRect();
        return { g: name, mid: r ? r.top + r.height / 2 : 0 };
      });
      try { p.el.setPointerCapture(p.pointerId); } catch { /* pointer already gone */ }
      (navigator as any).vibrate?.(10);
      const height = groupRefs.current.get(g)?.getBoundingClientRect().height ?? 0;
      setGroupDrag({ g, from: p.index, over: p.index, dy: 0, height });
    }, holdMs);
    groupPress.current = { g, index, y: e.clientY, el, pointerId, timer };
  };

  const onGroupHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = groupPress.current;
    const d = groupDragRef.current;
    if (!p || !d) return;
    const dy = e.clientY - p.y;
    const center = groupRects.current[d.from]?.mid + dy;
    let over = d.from, best = Infinity;
    groupRects.current.forEach((r, i) => {
      const dist = Math.abs(center - r.mid);
      if (dist < best) { best = dist; over = i; }
    });
    setGroupDrag({ ...d, dy, over });
  };

  const onGroupHandleUp = () => {
    const p = groupPress.current;
    const d = groupDragRef.current;
    if (p) clearTimeout(p.timer);
    groupPress.current = null;
    if (d) {
      if (d.over !== d.from) {
        const next = orderedGroupNames.slice();
        next.splice(d.from, 1);
        next.splice(d.over, 0, d.g);
        applyGroupOrder(next);
      }
      setGroupDrag(null);
    }
  };

  const onGroupHandleCancel = () => {
    const p = groupPress.current;
    if (p) clearTimeout(p.timer);
    groupPress.current = null;
    setGroupDrag(null);
  };

  // While a section drag is live, stop the page from scrolling under the finger.
  useEffect(() => {
    if (!groupDrag) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", stop, { passive: false });
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("touchmove", stop);
      document.body.style.userSelect = "";
    };
  }, [groupDrag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupDragStyle = (g: string, index: number): React.CSSProperties | undefined => {
    if (!groupDrag) return undefined;
    if (g === groupDrag.g) {
      return { transform: `translateY(${groupDrag.dy}px)`, zIndex: 30, position: "relative", boxShadow: "0 12px 32px rgba(0,0,0,0.18)", transition: "none" };
    }
    const shift = groupDrag.height + 24; // 24px = mt-6 between sections
    if (index > groupDrag.from && index <= groupDrag.over) return { transform: `translateY(${-shift}px)`, transition: "transform 0.15s ease" };
    if (index < groupDrag.from && index >= groupDrag.over) return { transform: `translateY(${shift}px)`, transition: "transform 0.15s ease" };
    return { transition: "transform 0.15s ease" };
  };

  return (
    <div className="mx-auto max-w-2xl" data-tour="tasks">
      <h1 className="font-display text-3xl font-semibold">Tasks</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        Queue what you'll study. Pick one to focus on.
        <InfoTip text="Click a task's name to edit it (Enter saves, Esc cancels). The n/n counter shows focus sessions done vs. planned — tap it to change the plan. Press ▶ to start focusing on a task. Tap a subject header to collapse it, drag ⋮⋮ to reorder tasks or whole subjects, and drag a task onto another subject (or tap its badge) to move it there." />
      </p>
      {/* Secondary preference tucked into a collapsed disclosure so task
          creation stays the page's primary action. */}
      <div className="mt-3 rounded-xl border border-border bg-card/70">
        <button onClick={() => setShowTaskPrefs((s: boolean) => !s)} aria-expanded={showTaskPrefs}
          className="flex min-h-[2.75rem] w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition hover:text-foreground">
          <span className="flex items-center gap-1.5"><Settings2 size={14} /> Task preferences</span>
          <ChevronDown size={15} className={`transition-transform ${showTaskPrefs ? "rotate-180" : ""}`} />
        </button>
        {showTaskPrefs && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
            <span className="min-w-0"><span className="block text-sm font-medium">Complete tasks automatically</span><span className="block text-[11px] text-muted-foreground">When on, a task is checked off as soon as it reaches its planned focus-session count.</span></span>
            <button role="switch" aria-label="Complete tasks automatically" aria-checked={autoCompleteEstimates} onClick={onToggleAutoComplete} className={`relative h-6 w-11 shrink-0 rounded-full transition ${autoCompleteEstimates ? "bg-primary" : "bg-border"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${autoCompleteEstimates ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        )}
      </div>
      {/* Planned study gets the same disclosure treatment as Task preferences
          (identical header classes, so the collapsed sizes match) and starts
          minimized. Expanded, the panel renders `bare` inside the disclosure. */}
      <div className="mt-3 rounded-xl border border-border bg-card/70">
        <button onClick={() => setShowPlanned((s: boolean) => !s)} aria-expanded={showPlanned}
          className="flex min-h-[2.75rem] w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition hover:text-foreground">
          <span className="flex items-center gap-1.5"><CalendarClock size={14} /> Planned study</span>
          <ChevronDown size={15} className={`transition-transform ${showPlanned ? "rotate-180" : ""}`} />
        </button>
        {showPlanned && (
          <div className="border-t border-border p-4">
            <PlannedStudyPanel bare tasks={tasks} plans={plannedSessions} userId={session?.user.id ?? null}
              isPremium={session ? (profile ? !!profile.is_premium : null) : false}
              onSignIn={onSignIn} onUpgrade={onSubscribe}
              onCreatePlan={onCreatePlan} onUpdatePlan={onUpdatePlan} onDeletePlan={onDeletePlan} />
          </div>
        )}
      </div>
      {tasks.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{doneTasks.length} of {tasks.length} done</span>
            {doneTasks.length === tasks.length && <span className="text-roamly-green">All clear 🎉</span>}
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}
            role="progressbar" aria-label="Task completion progress" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(tasks.length ? (doneTasks.length / tasks.length) * 100 : 0)}>
            <div className="h-full rounded-full bg-roamly-green" style={{ width: `${tasks.length ? (doneTasks.length / tasks.length) * 100 : 0}%`, transition: "width 0.4s ease" }} />
          </div>
        </div>
      )}
      {!session && (
        <div className="mt-4">
          <SignInPrompt onSignIn={onSignIn}
            message={`Guest tasks stay on this device. ${tasks.length} of ${guestLimit} used. Create a free account to sync and use AI uploads.`} />
        </div>
      )}
      {session && (
        <div className="mt-4">
          <UploadTasksPanel profile={profile} session={session} onImported={addImportedTasks} onUpgrade={onSubscribe} onBuyCredits={onBuyCredits} />
        </div>
      )}
      {/* On phones the task input takes the full row and the subject + add
          button drop to a second line; side-by-side from sm up. */}
      <div className="mt-6 flex flex-wrap gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a study task…"
          className="w-full min-w-0 rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-auto sm:flex-1" />
        {showCustom ? (
          <span className="flex items-center gap-1">
            <input value={customTag ?? ""} onChange={(e) => setCustomTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder={noSubjectsYet ? "Subject, e.g. Pharm" : "New subject"} maxLength={24} autoFocus={customTag !== null} aria-label="New subject name"
              className="w-32 rounded-xl border border-primary bg-card px-3 py-3 text-sm outline-none ring-2 ring-primary/20" />
            {!noSubjectsYet && (
              <button onClick={() => setCustomTag(null)} aria-label="Cancel new subject"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:text-foreground">
                <X size={15} />
              </button>
            )}
          </span>
        ) : (
          <ThemedSelect value={selectedTag} ariaLabel="Subject" className="w-40 min-w-0 flex-1 sm:flex-none"
            onChange={(v) => (v === "__new__" ? setCustomTag("") : setTag(v))}
            options={[
              ...tags.map((t) => ({ value: t, label: t, accent: tagColor(t) })),
              { value: "__new__", label: "＋ New subject…" },
            ]} />
        )}
        <ThemedSelect value={String(estDraft)} className="w-28 min-w-0"
          ariaLabel="How many focus sessions will it take to complete this task?"
          onChange={(v) => setEstDraft(Number(v))}
          options={Array.from({ length: 9 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} session${i === 0 ? "" : "s"}` }))} />
        <button onClick={add} disabled={!session && tasks.length >= guestLimit} aria-label="Add task"
          className="flex min-h-[2.75rem] shrink-0 items-center gap-1.5 rounded-xl gradient-primary px-4 font-semibold text-white shadow-glow transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">
          <Plus size={17} /> <span className="text-sm">Add Task</span>
        </button>
      </div>
      {!session && tasks.length >= guestLimit && <p role="status" className="mt-2 text-sm text-muted-foreground">You reached the 5-task guest limit. Sign in to create and sync more tasks.</p>}

      {session && !tasksLoaded && (
        <p className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-center text-sm text-muted-foreground">
          Loading your tasks…
        </p>
      )}

      {tasksLoaded && open.length === 0 && tasks.length > 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-center text-sm text-muted-foreground">
          Everything's done. Add your next study task above.
        </p>
      )}

      {(!session || tasksLoaded) && orderedGroupNames.map((g, gi) => {
        const groupTasks = open.filter((t: Task) => t.tag === g);
        const groupIds = groupTasks.map((t: Task) => t.id);
        const c = tagColor(g);
        const collapsed = collapsedTags.includes(g);
        const beingGroupDragged = groupDrag?.g === g;
        const isDropTarget = dropTag === g;
        return (
          <section key={g} className={`mt-6 ${beingGroupDragged ? "rounded-2xl bg-card/95 p-2 ring-2 ring-primary/50" : ""} ${isDropTarget ? "rounded-2xl bg-primary/10 p-2 ring-2 ring-primary/60" : ""}`}
            ref={(el) => { if (el) groupRefs.current.set(g, el); else groupRefs.current.delete(g); }}
            style={groupDragStyle(g, gi)}>
            <div className="flex items-center gap-1">
              <button data-group-handle onPointerDown={(e) => onGroupHandleDown(e, g, gi)} onPointerMove={onGroupHandleMove}
                onPointerUp={onGroupHandleUp} onPointerCancel={onGroupHandleCancel}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") { e.preventDefault(); moveGroup(g, -1); }
                  if (e.key === "ArrowDown") { e.preventDefault(); moveGroup(g, 1); }
                }}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={`Reorder subject ${g}. Drag, or press the up and down arrow keys.`}
                className="grid h-8 w-6 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground/60 transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 active:cursor-grabbing"
                style={{ touchAction: "none", WebkitTouchCallout: "none" }}>
                <GripVertical size={14} />
              </button>
              <button onClick={() => toggleCollapsed(g)} aria-expanded={!collapsed}
                aria-label={`${collapsed ? "Expand" : "Collapse"} subject ${g} (${groupTasks.length} task${groupTasks.length === 1 ? "" : "s"})`}
                className="flex min-h-[2.5rem] min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-1.5 py-1 text-left transition hover:bg-primary/5">
                <span className="flex min-w-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
                  <span className="min-w-0 truncate">{g}</span> · {groupTasks.length}
                </span>
                <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
              </button>
            </div>
            {!collapsed && (
            <div className="mt-2 space-y-2">
              {groupTasks.map((t: Task, i: number) => {
                const active = activeTask === t.id;
                const beingDragged = drag?.id === t.id;
                return (
                  <div key={t.id}
                    ref={(el) => { if (el) rowRefs.current.set(t.id, el); else rowRefs.current.delete(t.id); }}
                    onPointerDown={(e) => onRowPointerDown(e, t.id, g, groupIds, i)}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp}
                    onPointerCancel={onRowPointerCancel}
                    onContextMenu={(e) => { if (press.current || dragRef.current) e.preventDefault(); }}
                    style={{ WebkitTouchCallout: "none", touchAction: "pan-y", ...dragStyleFor(g, t.id, i) }}
                    className={`select-none rounded-xl border p-3 transition ${beingDragged ? "border-primary bg-card" : active ? "border-primary bg-primary/5" : "border-border bg-card/70"}`}>
                    {/* Phones: checkbox + title on the first line, the control
                        cluster on its own right-aligned line below (titles were
                        wrapping 3 lines against 6 inline controls). Inline
                        again from sm up. */}
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                      <button data-drag-handle aria-hidden tabIndex={-1} onContextMenu={(e) => e.preventDefault()}
                        className="-ml-1 -mr-2 mt-0.5 grid h-6 w-5 shrink-0 cursor-grab place-items-center text-muted-foreground/50 active:cursor-grabbing"
                        style={{ touchAction: "none" }}>
                        <GripVertical size={14} />
                      </button>
                      <button data-nodrag onClick={() => toggleTask(t.id)} aria-label={`Mark ${t.title} done`}
                        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-muted-foreground/40 transition hover:border-primary" />
                      {editingId === t.id ? (
                        <span data-nodrag className="min-w-0 flex-1 basis-52">
                          <input autoFocus value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                            onBlur={commitEdit} aria-label={`Edit task title, currently ${t.title}`}
                            className="w-full rounded-lg border border-primary bg-card px-2 py-1 text-sm outline-none ring-2 ring-primary/20" />
                          <span className="mt-1 block text-[10px] text-muted-foreground">Enter saves · Esc cancels · empty titles aren't saved</span>
                        </span>
                      ) : (
                        <button onClick={() => { if (!justDragged.current) startEdit(t); }} className="min-w-0 flex-1 basis-52 rounded-lg text-left transition hover:bg-primary/5"
                          aria-label={`${t.title} — edit task title`} title="Click to edit">
                          <span className="block min-w-0 break-words text-sm leading-snug">{t.title}</span>
                          {active && (
                            <span className="mt-1 flex items-center gap-2">
                              <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                <Timer size={10} /> Focusing
                              </span>
                            </span>
                          )}
                        </button>
                      )}
                      <button data-nodrag onClick={() => setTagPickTarget(t)} aria-label={`Change subject for ${t.title}, currently ${t.tag}`}
                        title="Click to move this task to another subject"
                        className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold transition hover:ring-2 hover:ring-primary/30"
                        style={{ background: `${tagColor(t.tag)}1f`, color: tagColor(t.tag) }}>
                        {t.tag}
                      </button>
                      <div data-nodrag className="ml-auto flex shrink-0 items-center gap-0.5">
                        {!active && (
                          <button onClick={() => onFocusTask(t.id)} aria-label={`Focus on ${t.title}`}
                            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary">
                            <Play size={13} />
                          </button>
                        )}
                        <button data-nodrag onClick={() => setEstTarget(t)} title="Focus sessions done / planned. Click to change"
                          className="rounded-md px-1.5 py-0.5 text-center font-mono text-xs text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                          aria-label={`${t.poms} of ${t.est} focus sessions done for ${t.title}. Change estimate`}>
                          {t.poms}/{t.est}
                        </button>
                        <button onClick={() => removeTask(t.id)} aria-label={`Delete ${t.title}`}
                          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:text-destructive">
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </section>
        );
      })}

      {doneTasks.length > 0 && (
        <section className="mt-8">
          <button onClick={() => setShowDone((s) => !s)}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-card/60 px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
            <span className="flex items-center gap-2"><Check size={14} className="text-roamly-green" /> Completed · {doneTasks.length}</span>
            <ChevronDown size={15} className={`transition-transform ${showDone ? "rotate-180" : ""}`} />
          </button>
          {showDone && (
            <div className="mt-2 space-y-2">
              {doneTasks.map((t: Task) => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/50 p-3">
                  <button onClick={() => toggleTask(t.id)} aria-label={`Mark ${t.title} not done`}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-roamly-green bg-roamly-green transition hover:opacity-80">
                    <Check size={14} className="text-white" />
                  </button>
                  <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground line-through">{t.title}</span>
                  <TagPill tag={t.tag} />
                  <button onClick={() => removeTask(t.id)} aria-label={`Delete ${t.title}`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:text-destructive">
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tagPickTarget && <TaskCategoryModal task={tagPickTarget} tags={tags} onPick={(next: string) => setTaskTag(tagPickTarget.id, next)} onClose={() => setTagPickTarget(null)} />}
      {estTarget && <TaskEstModal task={estTarget} onPick={(n: number) => setTaskEst(estTarget.id, n)} onClose={() => setEstTarget(null)} />}
    </div>
  );
}

function DailyGoalCard({ streak, todayMinutes, dailyGoal, setDailyGoal }: any) {
  const pct = Math.min(100, Math.round((todayMinutes / dailyGoal) * 100));
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">Your progress
          <InfoTip text="Minutes count when a focus block finishes. Hit your daily goal to fill the bar, and focus at least once a day to keep your streak flame alive." />
        </h2>
        {streak > 0 && (
          <span className="flex items-center gap-1 text-xs text-primary"><Flame size={13} /> {streak}-day streak</span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Today</span>
        <span className="font-mono">{todayMinutes} / {dailyGoal} min</span>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}
        role="progressbar" aria-label="Daily goal progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%`, transition: "width 0.4s ease" }} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm text-muted-foreground">Daily goal</span>
        <NumberField value={dailyGoal} unit="min" min={5} max={600} label="Daily goal" onChange={setDailyGoal} />
      </div>
    </div>
  );
}

function AnalyticsView({ isPremium, onUpsell, onStartFocus, streak, todayMinutes, dailyGoal, setDailyGoal, session, onSignIn, sessions, tasks, studyEvents, plannedSessions }: any) {
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
          <><DailyGoalCard streak={streak} todayMinutes={todayMinutes} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal} /><div className="mt-3"><SignInPrompt onSignIn={onSignIn} message="Guest analytics stay in this browser only. Create a free account to keep your history and streaks everywhere." /></div></>
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
        {weekMin > 0 ? (
          <div className="h-52">
            <Suspense fallback={<div className="h-full w-full animate-pulse rounded-xl bg-border/40" />}>
              <WeekChart week={week} />
            </Suspense>
          </div>
        ) : (
          <div className="grid h-52 place-items-center rounded-xl border border-dashed border-border">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Complete your first focus session and your week appears here.</p>
              <button onClick={onStartFocus}
                className="mt-3 min-h-[44px] rounded-full gradient-primary px-5 py-2 text-sm font-semibold text-white shadow-glow transition active:scale-95">
                Start focusing
              </button>
            </div>
          </div>
        )}
      </div>

      {isPremium ? (
        <StudyInsights events={studyEvents} daily={sessions} plans={plannedSessions} />
      ) : (
        // One pitch instead of a stack of locked cards: every Premium analytics
        // feature lives behind this single CTA.
        <div className="mt-6">
          <LockedFeaturePreview title="Deeper insights" onUpgrade={onUpsell}
            description="Premium turns the basics above into a full picture of how you actually study."
            bullets={[
              "Study breakdown by task, category, and time range",
              "Subject split of your completed focus sessions",
              "Post-mortems: follow-through patterns and missed-session reasons",
              "Full focus history, active days, and personal records",
            ]} />
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
      ) : null}

      {isPremium && (
        <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Study history</h2>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <Stat label="Total focus" value={`${hrs}h ${totalMin60 % 60}m`} />
            <Stat label="Active days" value={String(activeDays)} />
            <Stat label="Best day ever" value={`${bestDayEver}m`} />
          </div>
        </div>
      )}
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

function PremiumView({ isPremium, session, profile, onSubscribe, checkoutLoading, checkoutError }: any) {
  // A comped/admin-granted Premium account never went through Stripe checkout,
  // so it has no customer to open the billing portal for. Only offer "Manage
  // subscription" when there's an actual Stripe customer behind the account.
  const hasStripeSubscription = !!profile?.stripe_subscription_id;
  const perks = ["Planned study scheduling", "10 AI note uploads each month", "Breakdowns, achievements & post-mortem", "Full analytics history", "Host up to 3 live study rooms", "Voice chat during room breaks", "PANCE & Marathon methods"];
  const credits = (profile?.ai_credits as number | undefined) ?? 0;
  // [feature, no account, free account, Premium account], grouped by the part
  // of the app each row belongs to so the table scans as four short lists
  // instead of one long one. Every theme is free for everyone, so themes
  // intentionally do not appear as a tier difference.
  type CompareRow = [string, string | boolean, string | boolean, string | boolean];
  const compareGroups: { group: string; rows: CompareRow[] }[] = [
    {
      group: "Plan", rows: [
        ["Price", "$0", "$0", "$3 monthly or $30 yearly"],
        ["Tasks", "5 on this device", "Unlimited + synced", "Unlimited + synced"],
        ["Exam schedules", false, "Multiple + synced", "Multiple + synced"],
        ["AI note uploads", false, "3 a month", "10 a month"],
        ["Extra upload credits", false, "Buy anytime", "Buy anytime"],
        ["Planned study", false, false, true],
      ],
    },
    {
      group: "Focus", rows: [
        ["Timer methods", "Core methods", "Core methods", "+ PANCE Drill & Marathon"],
      ],
    },
    {
      group: "Community", rows: [
        ["Study rooms", "Browse only", "Join any room", "Join + host up to 3"],
        ["Room break chat", false, true, true],
        ["Voice chat during breaks", false, false, true],
      ],
    },
    {
      group: "Progress", rows: [
        ["Analytics", "7-day local basics", "7-day synced basics", "Breakdowns, achievements & full history"],
      ],
    },
  ];
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  // In-app cancel: sets Stripe's cancel_at_period_end, so Premium runs through
  // the already-paid period and then lapses. Local state reflects the API
  // response immediately; the webhook + realtime profile refresh make it stick.
  const [pendingCancel, setPendingCancel] = useState<boolean>(!!profile?.premium_cancel_at_period_end);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  useEffect(() => { setPendingCancel(!!profile?.premium_cancel_at_period_end); }, [profile?.premium_cancel_at_period_end]);
  const periodEndText = profile?.premium_expires_at ? new Date(profile.premium_expires_at).toLocaleDateString() : null;

  const changeCancel = async (resume: boolean) => {
    if (!resume && !window.confirm(`Cancel your subscription? Premium stays active until ${periodEndText ?? "the end of the paid period"}, then your account returns to the free tier.`)) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const token = await getAccessToken();
      if (!token) { setCancelBusy(false); return; }
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", resume }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setCancelError(data.error ?? "Couldn't update the subscription. Try again."); setCancelBusy(false); return; }
      setPendingCancel(data.cancel_at_period_end === true);
      setCancelBusy(false);
    } catch {
      setCancelError("Couldn't reach the payments server. Try again soon.");
      setCancelBusy(false);
    }
  };

  // Monthly allowance vs purchased credits, mirroring UploadTasks: the
  // allowance resets each month (no rollover); purchased credits never expire.
  const usedThisPeriod = profile?.ai_uploads_period === currentUploadPeriod() ? (profile?.ai_uploads_count ?? 0) : 0;
  const monthlyQuota = isPremium ? PREMIUM_MONTHLY_UPLOAD_QUOTA : FREE_MONTHLY_UPLOAD_QUOTA;
  const monthlyRemaining = Math.max(0, monthlyQuota - usedThisPeriod);

  // Stripe Billing Portal: update card, view invoices, or cancel. Cancelling
  // flows through the webhook, which reverts the account to free automatically.
  const openPortal = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const token = await getAccessToken();
      if (!token) { setPortalLoading(false); return; }
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "portal" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setPortalError(data.error ?? "Couldn't open the billing portal. Try again.");
        setPortalLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setPortalError("Couldn't reach the billing portal. Try again soon.");
      setPortalLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">{isPremium ? "Your Premium" : "Go Premium"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Built for the long road to the PANCE.</p>

      {!isPremium && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-border bg-card/70">
          <table className="min-w-[720px] w-full table-fixed text-left">
            <thead className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr><th scope="col" className="w-[31.25%] px-4 py-2.5">What you get</th><th scope="col" className="px-3 py-2.5">No account</th><th scope="col" className="px-3 py-2.5">Free account</th><th scope="col" className="px-3 py-2.5 text-primary">Premium account</th></tr>
            </thead>
            <tbody>
            {compareGroups.map(({ group, rows }) => (
              <Fragment key={group}>
                <tr className="border-b border-border/50 bg-secondary/40">
                  <th scope="colgroup" colSpan={4} className="px-4 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{group}</th>
                </tr>
                {rows.map(([feature, guest, free, prem]) => (
                  <tr key={feature} className="border-b border-border/50 text-sm last:border-b-0">
                    <th scope="row" className="min-w-0 px-4 py-2 font-normal text-muted-foreground">{feature}</th>
                    {[guest, free, prem].map((value, index) => (
                      <td key={index} className={`min-w-0 px-3 py-2 text-xs ${index === 2 ? "font-medium" : ""}`}>
                        {value === true ? <Check size={15} className="text-roamly-green" /> : value === false ? <span className="text-muted-foreground/50">-</span> : value}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
            </tbody>
          </table>
        </div>
      )}

      {isPremium && (
        <div className="mt-6 rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-medium"><Crown size={15} className="text-primary" /> Premium is active. Thanks for supporting Roamly Flow.</p>
          {session && (
            <p className="mt-2 rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              AI uploads: <span className="font-medium text-foreground">{monthlyRemaining} of {monthlyQuota}</span> left this month
              {" · "}<span className="font-medium text-foreground">{credits}</span> purchased credit{credits === 1 ? "" : "s"}.
              {" "}Purchased credits never expire. The monthly allowance resets each month and does not roll over.
            </p>
          )}
          {hasStripeSubscription ? (
            <>
              {pendingCancel ? (
                <p className="mt-2 text-xs font-medium text-roamly-coral">
                  Your subscription is set to cancel{periodEndText ? ` and Premium ends on ${periodEndText}` : " at the end of the paid period"}. You keep everything until then.
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Manage billing below: update your card, see invoices, or cancel. If you cancel (or a payment stops), your account automatically returns to the free tier at the end of the paid period.</p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button onClick={openPortal} disabled={portalLoading}
                  className="rounded-full border border-border bg-card px-5 py-2 text-sm font-medium transition hover:border-primary/40 disabled:opacity-60">
                  {portalLoading ? "Opening…" : "Manage subscription"}
                </button>
                {pendingCancel ? (
                  <button onClick={() => changeCancel(true)} disabled={cancelBusy}
                    className="rounded-full gradient-primary px-5 py-2 text-sm font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">
                    {cancelBusy ? "Saving…" : "Keep subscription"}
                  </button>
                ) : (
                  <button onClick={() => changeCancel(false)} disabled={cancelBusy}
                    className="rounded-full border border-destructive/40 px-5 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-60">
                    {cancelBusy ? "Saving…" : "Cancel subscription"}
                  </button>
                )}
              </div>
              {portalError && <p className="mt-2 text-xs text-destructive">{portalError}</p>}
              {cancelError && <p className="mt-2 text-xs text-destructive">{cancelError}</p>}
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Premium comes from an internal account grant.
              {profile?.premium_expires_at ? ` Access lasts through ${new Date(profile.premium_expires_at).toLocaleDateString()}.` : ""}
            </p>
          )}
        </div>
      )}
      {!isPremium && (
        <div className="mt-6 overflow-hidden rounded-3xl gradient-accent p-px shadow-glow">
          <div className="rounded-3xl bg-card/95 p-7 backdrop-blur">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-card/70 p-4">
                <div className="flex items-baseline gap-2"><span className="font-display text-3xl font-bold">$3</span><span className="text-muted-foreground">/ month</span></div>
                <button onClick={() => onSubscribe("monthly")} disabled={checkoutLoading} className="mt-3 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">Choose monthly</button>
              </div>
              <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
                <div className="flex items-baseline gap-2"><span className="font-display text-3xl font-bold">$30</span><span className="text-muted-foreground">/ year</span></div>
                <p className="mt-0.5 text-xs text-primary">$2.50 a month equivalent · save $6 a year</p>
                <button onClick={() => onSubscribe("annual")} disabled={checkoutLoading} className="mt-3 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">Choose annual</button>
              </div>
            </div>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {perks.map((p) => (
                <div key={p} className="flex items-center gap-2 text-sm">
                  <Check size={16} className="shrink-0 text-roamly-green" /> {p}
                </div>
              ))}
            </div>
            {checkoutError && <p className="mt-2 text-center text-xs text-destructive">{checkoutError}</p>}
            <p className="mt-2 text-center text-xs text-muted-foreground">Secure subscription billing via Stripe. Cancel anytime.</p>
          </div>
        </div>
      )}

      {/* Credit packs — one-time purchases, for subscribers and free users alike. */}
      <div className="mt-6 rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Plus size={15} className="text-primary" /> Upload credits, no subscription needed
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Extra AI note uploads you buy once. They never expire and are used automatically after your monthly allowance
          ({isPremium ? "10 with Premium" : "3 free"}) runs out.
          {session && <span className="font-medium text-foreground"> You have {credits} credit{credits === 1 ? "" : "s"}.</span>}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { id: "small" as const, credits: 2, price: "$1" },
            { id: "large" as const, credits: 5, price: "$2" },
          ].map((p) => (
            <div key={p.id} className="rounded-2xl border border-border bg-card/70 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">{p.credits} uploads</span>
                <span className="font-display text-xl font-bold">{p.price}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Upload credits only. This does not unlock Premium.</p>
              <button onClick={() => onSubscribe(p.id)} disabled={checkoutLoading}
                className="mt-3 w-full rounded-full border border-primary/50 bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 active:scale-95 disabled:opacity-60">
                {session ? (checkoutLoading ? "Redirecting…" : "Buy with Stripe") : "Sign in to buy"}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">One-time purchase · credits never expire · secure checkout via Stripe.</p>
      </div>

      <div className="mt-6 rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Common questions</h2>
        <div className="mt-2 divide-y divide-border/50">
          {[
            ["Can I cancel anytime?", "Yes. Cancel here or in the Stripe billing portal. Premium stays active until the end of the period you've paid for, then your account returns to the free tier automatically — no partial-month charges."],
            ["What happens to my data if I downgrade?", "Nothing is deleted. Your tasks, focus history, streaks, and stats stay on your account; the Premium-only views simply lock again until you resubscribe."],
            ["Do upload credits expire?", "Purchased credits never expire. They're used automatically after your monthly allowance (3 free, 10 with Premium) runs out, and the allowance itself resets each month without rolling over."],
            ["How is payment handled?", "All billing runs through Stripe. Roamly Flow never sees or stores your card details."],
          ].map(([q, a]) => (
            <details key={q} className="group py-1">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <ChevronDown size={15} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="pb-3 text-xs leading-relaxed text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}


function FocusTasksCard({ tasks, activeTask, setActiveTask, toggleTask, estimateReachedTask, onResolveEstimate, breakActive = false, breakKey = "" }: any) {
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
      {/* Checking an optional break task removes it from the list. */}
      {breakPicks.some((a: Activity) => !breakDone.includes(a.id)) && (
        <div className="mt-2 space-y-1.5">
          {breakPicks.filter((a: Activity) => !breakDone.includes(a.id)).map((a: Activity) => (
            <div key={a.id}
              className="flex w-full items-center gap-2 rounded-xl border border-roamly-green/40 bg-roamly-green/5 px-3 py-2 transition">
              {/* Empty box: tapping clears this one task and nothing else.
                  No check icon (even on hover) so a neighbor that shifts under
                  the finger never looks auto-checked. */}
              <button onClick={() => setBreakDone((v) => [...v, a.id])}
                aria-label={`Clear optional break task ${a.title}`}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-roamly-green/50 transition hover:border-roamly-green hover:bg-roamly-green/10" />
              <span className="min-w-0 flex-1 truncate text-sm" title={a.instruction}>{a.title}</span>
              <span className="shrink-0 rounded-full bg-roamly-green/10 px-2 py-0.5 text-[10px] font-semibold text-roamly-green">Optional</span>
            </div>
          ))}
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

function Upsell({ onClose, onUpgrade, onBuyCredits }: { onClose: () => void; onUpgrade: () => void; onBuyCredits?: () => void }) {
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

// Phones show five primary tabs (Focus, Tasks, Rooms, Garden, Analytics);
// from sm up all six tabs render. Premium stays reachable from the header's
// crown button, and account/help/theme/tour from the profile menu, so no
// mobile "More" sheet is needed. Active state is never color-only: heavier
// icon stroke plus an underline bar, and aria-current for assistive tech.
const MOBILE_PRIMARY = new Set(["focus", "tasks", "rooms", "garden", "analytics"]);

function BottomNav({ nav, view, setView }: any) {
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
  const tab = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 transition ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg">
      <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
        {nav.map((n: any) => {
          const Icon = n.icon;
          const active = view === n.id;
          return (
            <button key={n.id} onClick={() => setView(n.id)} aria-current={active ? "page" : undefined}
              className={`${MOBILE_PRIMARY.has(n.id) ? "flex" : "hidden sm:flex"} ${tab(active).replace(/^flex /, "")}`}>
              <span className="relative">
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                {n.locked && <Lock size={10} className="absolute -right-1.5 -top-1 rounded-full bg-card text-muted-foreground" />}
              </span>
              <span className="text-[10px] font-medium">{n.label}</span>
              <span aria-hidden className={`h-0.5 w-5 rounded-full ${active ? "bg-primary" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

