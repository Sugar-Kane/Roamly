import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Timer, ListChecks, BarChart3, Users, Check, Plus, Minus, Crown, Play, Pause, RotateCcw, SkipForward, X, Music, Palette, Flame, Bell, BellOff, CalendarClock, LogIn, ChevronDown, ChevronUp, Volume2, Lock, GripVertical, HelpCircle, PictureInPicture2, Pencil } from "lucide-react";
import { METHODS, THEMES, sortTasks, tagColor, type Task } from "./data";
import { useTimer, fmt, type Phase } from "./useTimer";
import { FOCUS_SOUNDS, startFocusSound, stopFocusSound, setFocusVolume, focusSoundActive, unlockAudio, musicCredit, duckFocusSound, type FocusSoundId } from "./focusSounds";
import { SPOTIFY_PRESETS, parseSpotifyUrl, toEmbedSrc as toSpotifyEmbedSrc, embedHeight, type SpotifyEmbedType } from "./spotify";
import { APPLE_MUSIC_PRESETS, parseAppleMusicUrl, toEmbedSrc as toAppleEmbedSrc, embedHeight as appleEmbedHeight, type AppleMusicEmbedType } from "./appleMusic";
const WeekChart = lazy(() => import("./Charts").then((m) => ({ default: m.WeekChart })));
const SubjectDonut = lazy(() => import("./Charts").then((m) => ({ default: m.SubjectDonut })));
import { supabase, arrivedViaEmailLink } from "./supabaseClient";
import { fetchProfile, startPremiumTrial, updateGoalAndExam, recordFocusSession, fetchRecentSessions, fetchStudyEvents, fetchPlannedStudySessions, createPlannedStudySession, updatePlannedStudySession, getAccessToken, fetchTasks, createTask, updateTask, deleteTask, checkIsAdmin, migrateGuestDataToAccount, type Profile } from "./db";
import { addSession, computeStreak, minutesToday, dateKey, type FocusSession } from "./streaks";
import { track, setTrackUser } from "./track";
import { loadPref, savePref } from "./storage";
import { FeedbackModal } from "./Feedback";
import { useEndOfPhaseAlerts } from "./useEndOfPhaseAlerts";
import { AuthPanel, SetPasswordModal } from "./Auth";
import { ProfileMenu, loadA11y, type A11ySettings } from "./ProfileMenu";
import { RoomsLive } from "./RoomsLive";
import { FocusMode, CompactSounds, TimeDisplay, InfoTip } from "./FocusMode";
import { PipTimer } from "./PipTimer";
import { useDocumentPip, applyThemeToPip } from "./useDocumentPip";
import { useCountUpTimer } from "./useCountUpTimer";
import { Tutorial } from "./Tutorial";
import { AdminView } from "./Admin";
import { Modal } from "./Modal";
import { NotificationsBell } from "./Notifications";
import { FriendsModal } from "./Friends";
import { UploadTasksPanel } from "./UploadTasks";
import { GUEST_TASK_LIMIT, loadGuestSessions, loadGuestTasks, saveGuestSessions, saveGuestTasks, clearMigratedGuestData } from "./guestData";
import { loadGuestStudyEvents, loadGuestStudyPlans, newStudyEvent, saveGuestStudyEvents, saveGuestStudyPlans, type MissedReason, type PlannedStudySession, type StudyEvent } from "./release3";
import { StudyInsights } from "./StudyInsights";
import { HealthyBreakActivities } from "./HealthyBreakActivities";
import { AdBreakPrompt, AdSubmitModal } from "./AdBreak";
import type { Session } from "@supabase/supabase-js";

export type View = "focus" | "tasks" | "analytics" | "rooms" | "premium" | "admin";

export default function App() {
  const [view, setView] = useState<View>("focus");
  const [immersive, setImmersive] = useState(false); // personal focus-mode takeover
  const [methodId, setMethodId] = useState("classic");
  const [themeId, setThemeId] = useState("coffee");
  const [tasks, setTasks] = useState<Task[]>(loadGuestTasks);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [activeTask, setActiveTask] = useState<string | null>(() => loadGuestTasks()[0]?.id ?? null);
  const [showUpsell, setShowUpsell] = useState(false);
  // User-editable values for the Custom method (minutes).
  const [custom, setCustom] = useState({ focus: 30, short: 7, long: 20, cycles: 4 });

  // First-run tour: shows once on a fresh device; the header "?" and the
  // profile menu's "App tour" row reopen it on demand.
  const [showTutorial, setShowTutorial] = useState(() => loadPref("roamly-tutorial-seen") !== "1");
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAd, setShowAd] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessions, setSessions] = useState<FocusSession[]>(loadGuestSessions);
  const [studyEvents, setStudyEvents] = useState<StudyEvent[]>(loadGuestStudyEvents);
  const [plannedSessions, setPlannedSessions] = useState<PlannedStudySession[]>(loadGuestStudyPlans);
  const [showAuth, setShowAuth] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [roomTarget, setRoomTarget] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // True when this page load came from an invite/recovery email link — the
  // user is signed in but passwordless, so we prompt them to set one.
  const [needsPassword, setNeedsPassword] = useState(arrivedViaEmailLink);
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
      setPlannedSessions(loadGuestStudyPlans());
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
      if (guestTasks.length > 0 || guestSessions.length > 0) {
        await migrateGuestDataToAccount(userId, guestTasks, guestSessions);
        clearMigratedGuestData();
      }

      let nextProfile = await fetchProfile(userId);
      if (session?.user.email_confirmed_at && !nextProfile?.is_premium) {
        const trialReady = await startPremiumTrial();
        if (trialReady) nextProfile = await fetchProfile(userId);
      }
      if (cancelled) return;
      setProfile(nextProfile);

      const [recent, events, planned, taskRows] = await Promise.all([
        fetchRecentSessions(userId),
        fetchStudyEvents(userId),
        fetchPlannedStudySessions(userId),
        fetchTasks(userId),
      ]);
      if (cancelled) return;
      setSessions(recent);
      setStudyEvents(events);
      setPlannedSessions(planned);
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
  useEffect(() => { if (!session) saveGuestStudyPlans(plannedSessions); }, [session, plannedSessions]);

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

  const handlePhaseComplete = useCallback((finishedPhase: Phase) => {
    alerts.notify(finishedPhase);
    if (finishedPhase !== "focus") return;
    track("focus_block_done");
    // Credit the completed Pomodoro to whichever task was active when the phase finished.
    const current = activeTask ? tasks.find((t) => t.id === activeTask) : undefined;
    if (current) {
      const nextPoms = current.poms + 1;
      const finished = nextPoms >= current.est && !current.done;
      setTasks((prev) => prev.map((t) => (t.id === activeTask ? { ...t, poms: nextPoms, done: finished ? true : t.done } : t)));
      if (session?.user.id) updateTask(activeTask!, finished ? { poms: nextPoms, done: true } : { poms: nextPoms });
      if (finished) {
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
    if (session?.user.id) void recordFocusSession(dateKey(), method.focus, current, "countdown");
  }, [alerts.notify, session?.user.id, method.focus, activeTask, tasks]);

  // Auto-flow: roll straight from focus into break (and back) like rooms do,
  // for users who don't want to press Start at every boundary. Default off —
  // the classic "own your start" behavior.
  const [autoFlow, setAutoFlow] = useState(() => loadPref("roamly-autostart") === "1");
  const toggleAutoFlow = () => setAutoFlow((v) => { savePref("roamly-autostart", v ? "0" : "1"); return !v; });
  const timer = useTimer(method, handlePhaseComplete, autoFlow);
  const countUp = useCountUpTimer();

  const completeCountUp = useCallback(() => {
    // Snapshot elapsed BEFORE the blocking confirm: countUp.stop() recomputes
    // from startedAt at call time, so any seconds the user spends on the dialog
    // would otherwise inflate the saved session past the duration it showed.
    const elapsed = countUp.elapsedSeconds;
    if (elapsed <= 0) return;
    if (!window.confirm(`Save this ${fmt(elapsed)} focus session to Analytics?`)) return;
    countUp.stop();
    const minutes = Math.max(1, Math.ceil(elapsed / 60));
    const current = activeTask ? tasks.find((t) => t.id === activeTask) : undefined;
    setSessions((prev) => addSession(prev, minutes));
    setStudyEvents((prev) => [...prev, newStudyEvent(minutes, current, "count_up")]);
    if (session?.user.id) void recordFocusSession(dateKey(), minutes, current, "count_up");
    track("count_up_complete", String(minutes));
  }, [countUp, session?.user.id, activeTask, tasks]);

  const createStudyPlan = useCallback(async (row: Pick<PlannedStudySession, "task_id" | "task_title" | "category" | "scheduled_for" | "expected_minutes">) => {
    if (session?.user.id) {
      const created = await createPlannedStudySession(session.user.id, row);
      if (created) setPlannedSessions((prev) => [created, ...prev]);
    } else {
      setPlannedSessions((prev) => [{ ...row, id: crypto.randomUUID(), status: "planned", missed_reason: null }, ...prev]);
    }
  }, [session?.user.id]);

  const updateStudyPlan = useCallback(async (id: string, fields: { status?: PlannedStudySession["status"]; missed_reason?: MissedReason | null }) => {
    if (session?.user.id && !await updatePlannedStudySession(id, fields)) return;
    setPlannedSessions((prev) => prev.map((plan) => plan.id === id ? { ...plan, ...fields } : plan));
  }, [session?.user.id]);

  // Picture-in-Picture: pop the timer into a small always-on-top window so it
  // stays visible while the user studies in other apps/tabs (desktop Chromium).
  const { pipWindow, supported: pipSupported, openPip, closePip } = useDocumentPip(theme, a11y);

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
    return saved && valid.has(saved) ? (saved as FocusSoundId) : "melody";
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
  const playEmbed = (t: { service: "spotify" | "apple"; src: string; height: number; label: string }) => {
    // Streaming takes over — silence and deselect the built-in focus sound.
    track("embed_play");
    stopFocusSound();
    setSoundPlaying(false);
    setFocusSound(null);
    savePref("roamly-focus-sound", "off");
    setEmbed(t);
  };

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
  const guardSolo = useCallback(() => {
    if (!inRoomRef.current) return true;
    if (!window.confirm("You're in a group study room. Leave the room and start your solo timer?")) return false;
    setLeaveSignal((s) => s + 1);
    return true;
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
    } else if (focusSoundActive()) {
      stopFocusSound();
      setSoundPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.running, timer.phase, soundAuto, focusSound]);

  // Usage ping when a session actually starts running (throttled in track()).
  useEffect(() => {
    if (timer.running) track("timer_start");
  }, [timer.running]);

  // Dim the music over the last ~5s of a focus block so it flows into the
  // break. The timer re-renders several times a second, so a ref guards the
  // duck to fire once per focus phase (reset when we leave the focus phase).
  const duckedRef = useRef(false);
  useEffect(() => {
    if (timer.phase !== "focus" || !timer.running) { duckedRef.current = false; return; }
    if (timer.secondsLeft <= 6 && timer.secondsLeft > 0 && !duckedRef.current && focusSoundActive()) {
      duckedRef.current = true;
      duckFocusSound(5);
    }
  }, [timer.secondsLeft, timer.running, timer.phase]);

  // Premium isn't a bottom-nav tab: it's reached from the profile-menu plan
  // card and the upsell popups, so it doesn't need a permanent slot here.
  const nav: { id: View; label: string; icon: typeof Timer }[] = [
    { id: "focus", label: "Focus", icon: Timer },
    { id: "tasks", label: "Tasks", icon: ListChecks },
    { id: "rooms", label: "Rooms", icon: Users },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ];

  const gateThen = (fn: () => void) => (isPremium ? fn() : setShowUpsell(true));
  const onSignIn = () => setShowAuth(true);
  const onSignOut = () => supabase?.auth.signOut();
  const changeTheme = (id: string) => { setThemeId(id); track("theme_change", id); };

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
  const setExam = (date: string | null, name: string | null) => {
    setProfile((p) => (p ? { ...p, exam_date: date, exam_name: name } : p));
    if (session?.user.id) updateGoalAndExam(session.user.id, { exam_date: date, exam_name: name });
  };

  // Task CRUD: optimistic local update always; when signed in, also persist to
  // Supabase (tasks table) so they survive across devices/sessions.
  const addTask = useCallback((title: string, tag: string) => {
    track("task_add");
    const userId = session?.user.id;
    const nextOrder = tasks.reduce((m, t) => Math.max(m, t.sort_order ?? 0), 0) + 1;
    if (userId) {
      createTask(userId, title, tag, nextOrder).then((row) => {
        if (row) setTasks((prev) => [...prev, row]);
      });
    } else {
      setTasks((prev) => prev.length >= GUEST_TASK_LIMIT ? prev : [...prev, { id: crypto.randomUUID(), title, tag, done: false, poms: 0, est: 1, sort_order: nextOrder }]);
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
    if (session?.user.id) updateTask(id, { done: nextDone });
  }, [tasks, session?.user.id]);

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
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(pack ? { pack } : { plan }),
      });
      if (!res.ok) { setCheckoutError("Payments aren't set up yet — check back soon."); setCheckoutLoading(false); return; }
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setCheckoutError("Couldn't reach the payments server. Try again soon.");
      setCheckoutLoading(false);
    }
  }, [session]);

  // Each tab opens at the top — carrying the previous tab's scroll position
  // over is disorienting, especially on phones.
  useEffect(() => { window.scrollTo(0, 0); track(`view_${view}`); }, [view]);

  // Apply the active theme's palette to the document root so every CSS variable
  // (background, card, primary, etc.) updates live across the whole app.
  // Accessibility overrides layer on top: they must run here (not as CSS
  // classes) because the theme vars are inline styles, which beat stylesheets.
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.classList.toggle("dark", !!theme.dark);
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
    <div className="min-h-screen w-full text-foreground font-sans" style={{ background: `linear-gradient(160deg, ${theme.grad[0]} 0%, ${theme.grad[1]} 90%)` }}>
      <OfflineBanner />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col px-5 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-7 md:px-8">
        <Header isPremium={isPremium} streak={streak} session={session} profile={profile}
          onSignIn={onSignIn} onSignOut={onSignOut}
          onOpenRoom={openRoomFromNotification} onOpenFriends={openFriends}
          a11y={a11y} setA11y={setA11y} onOpenPremium={() => setView("premium")}
          isAdmin={isAdmin} onOpenAdmin={() => setView("admin")}
          onOpenTutorial={() => setShowTutorial(true)}
          themeId={themeId} setThemeId={changeTheme}
          onOpenFeedback={() => (session ? setShowFeedback(true) : setShowAuth(true))} />
        <main className="mt-8 flex-1">
          {view === "focus" && (
            <FocusView method={method} methodId={methodId} setMethodId={setMethodId} timer={timer} theme={theme}
              tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask}
              custom={custom} setCustom={setCustom}
              isPremium={isPremium} gateThen={gateThen}
              examDate={examDate} examName={profile?.exam_name ?? null} setExam={setExam} alerts={alerts}
              embed={embed} playEmbed={playEmbed} guardSolo={guardSolo} immersive={immersive}
              autoFlow={autoFlow} onToggleAutoFlow={toggleAutoFlow} onOpenTasks={() => setView("tasks")}
              onAdvertise={() => (session ? setShowAd(true) : onSignIn())} onGoPremium={() => setShowUpsell(true)}
              countUp={countUp} onCompleteCountUp={completeCountUp}
              session={session} onSignIn={onSignIn} sounds={sounds}
              enterFocus={() => { setImmersive(true); track("focus_mode_enter"); }}
              pipSupported={pipSupported} pipActive={!!pipWindow}
              onPopOut={() => openPip().then((pip) => { if (pip) track("pip_open"); })} onClosePip={closePip} />
          )}
          {view === "tasks" && (
            <TasksView tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask}
              addTask={addTask} editTask={editTask} setTaskEst={setTaskEst} toggleTask={toggleTask} removeTask={removeTask}
              reorderTask={reorderTask} onFocusTask={focusTask}
              session={session} onSignIn={onSignIn} tasksLoaded={tasksLoaded}
              guestLimit={GUEST_TASK_LIMIT}
              profile={profile} addImportedTasks={addImportedTasks} onSubscribe={startCheckout}
              onBuyCredits={() => setView("premium")} />
          )}
          {view === "analytics" && (
            <AnalyticsView isPremium={isPremium} onUpsell={() => setShowUpsell(true)}
              streak={streak} todayMinutes={todayMinutes} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal}
              session={session} onSignIn={onSignIn} sessions={sessions} tasks={tasks}
              studyEvents={studyEvents} plannedSessions={plannedSessions} onCreatePlan={createStudyPlan} onUpdatePlan={updateStudyPlan} />
          )}
          {/* Rooms stay MOUNTED (just hidden) on other tabs: leaving the tab no
              longer kicks you out of a room — presence, the shared timer, room
              music, chat, and the pop-out keep running while you work on Tasks
              or anywhere else. */}
          <div className={view === "rooms" ? undefined : "hidden"}>
            <RoomsLive session={session} profile={profile} isPremium={isPremium} gateThen={gateThen} onSignIn={onSignIn}
              onNeedUsername={openFriends} onOpenFriends={openFriends}
              targetRoomId={roomTarget} onTargetConsumed={() => setRoomTarget(null)}
              soundAuto={soundAuto} onInRoom={handleInRoom} leaveSignal={leaveSignal}
              completionSoundEnabled={alerts.soundEnabled}
              pipSupported={pipSupported} pipWindow={pipWindow}
              onPopOut={() => openPip({ width: 191, height: 349 }).then((pip) => { if (pip) track("pip_open", "room"); })} onClosePip={closePip}
              onImportedTasks={addImportedTasks as (rows: unknown[]) => void} onUpgrade={startCheckout} />
          </div>
          {view === "premium" && (
            <PremiumView isPremium={isPremium} session={session} profile={profile} onSubscribe={startCheckout}
              checkoutLoading={checkoutLoading} checkoutError={checkoutError} />
          )}
          {view === "admin" && <AdminView isAdmin={isAdmin} />}
        </main>
      </div>
      <BottomNav nav={nav} view={view} setView={setView} />
      <FocusMode open={immersive} phase={timer.phase}
        phaseLabel={timer.phase === "focus" ? "Focus" : timer.phase === "short" ? "Short break" : "Long break"}
        timeText={fmt(timer.secondsLeft)} progress={timer.progress}
        title={tasks.find((t) => t.id === activeTask)?.title} subtitle={method.name}
        cycles={method.cycles} completed={timer.completedFocus}
        ring={timer.phase === "focus" ? theme.ring : theme.rest}
        onExit={() => setImmersive(false)}
        controls={
          <>
            <button onClick={() => { if (!timer.running) { if (!guardSolo()) return; countUp.reset(); unlockAudio(); } (timer.running ? timer.pause : timer.start)(); }}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl px-8 font-semibold text-white shadow-glow transition active:scale-[0.98]"
              style={{ background: timer.phase === "focus" ? theme.ring : theme.rest }} aria-label={timer.running ? "Pause" : "Resume"}>
              {timer.running ? <><Pause size={20} fill="currentColor" /> Pause</> : <><Play size={20} fill="currentColor" /> Resume</>}
            </button>
            <button onClick={timer.skip} className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground" aria-label="Skip">
              <SkipForward size={18} />
            </button>
            {pipSupported && (
              <button onClick={() => (pipWindow ? closePip() : openPip().then((pip) => { if (pip) track("pip_open", "focus_mode"); }))}
                className="grid h-12 w-12 place-items-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                aria-label={pipWindow ? "Close pop-out timer" : "Pop out timer"}>
                <PictureInPicture2 size={18} />
              </button>
            )}
            <button onClick={toggleAutoFlow} aria-pressed={autoFlow}
              className={`flex h-12 items-center rounded-2xl border px-4 text-xs font-medium transition ${autoFlow ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
              Auto-flow {autoFlow ? "on" : "off"}
            </button>
          </>
        }
        extra={
          // Order per user feedback: 1) Tasks, 2) built-in Music, 3) the
          // Spotify/Apple embed — so the two music boxes sit together under the
          // task list. The built-in sounds keep the same card styling the
          // FocusMode `music` slot gave them.
          <div className="space-y-4">
            <HealthyBreakActivities active={timer.phase !== "focus"} breakKey={`solo-${timer.phase}-${timer.completedFocus}`} />
            <AdBreakPrompt active={timer.phase !== "focus" && !isPremium}
              onAdvertise={() => (session ? setShowAd(true) : onSignIn())} onGoPremium={() => setShowUpsell(true)} />
            <FocusTasksCard tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask} toggleTask={toggleTask} />
            <div className="w-full rounded-2xl border border-border bg-card/70 p-3"><CompactSounds sounds={sounds} /></div>
            <MusicPanel embed={embed} onPlay={playEmbed} active={true} />
          </div>
        } />
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
          } />,
        pipWindow.document.body
      )}
      {showUpsell && <Upsell onClose={() => setShowUpsell(false)} onUpgrade={() => { setShowUpsell(false); startCheckout(); }}
        onBuyCredits={() => { setShowUpsell(false); setView("premium"); }} />}
      {showAuth && <AuthPanel onClose={() => setShowAuth(false)} />}
      {needsPassword && session && (
        <SetPasswordModal onDone={() => {
          setNeedsPassword(false);
          history.replaceState(null, "", window.location.pathname);
        }} />
      )}
      {showFriends && session && (
        <FriendsModal session={session} profile={profile} onClose={() => setShowFriends(false)} onUsernameSet={handleUsernameSet} />
      )}
      {/* Deferred while a password prompt from an email link is up. */}
      {showTutorial && !needsPassword && <Tutorial setView={setView} onClose={() => setShowTutorial(false)} />}
      {showFeedback && session && (
        <FeedbackModal userId={session.user.id} page={view} onClose={() => setShowFeedback(false)} />
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
      <BellOff size={13} /> You're offline — changes will sync when you reconnect.
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

function Header({ isPremium, streak, session, profile, onSignIn, onSignOut, onOpenRoom, onOpenFriends, a11y, setA11y, onOpenPremium, isAdmin, onOpenAdmin, onOpenTutorial, themeId, setThemeId, onOpenFeedback }: any) {
  // Single row on every screen size: the avatar (with the profile menu behind
  // it) is always pinned to the top right. Plan status and sign out live
  // inside the menu instead of loose header chips.
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="font-display text-2xl font-semibold tracking-tight text-gradient">Roamly</span>
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.22em] text-primary sm:inline">Focus</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden sm:block"><StreakBadge streak={streak} /></span>
        <button onClick={onOpenTutorial} aria-label="Replay the app tour"
          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
          <HelpCircle size={15} />
        </button>
        <ThemeMenu themeId={themeId} setThemeId={setThemeId} />
        {session && <NotificationsBell session={session} onOpenRoom={onOpenRoom} onOpenFriends={onOpenFriends} />}
        {/* Everyone who isn't premium gets a one-tap path to the plan page —
            guests land there too and hit the sign-in gate only at checkout. */}
        {!isPremium && (
          <button onClick={onOpenPremium}
            className="flex items-center gap-1.5 rounded-full gradient-primary px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition active:scale-95">
            <Crown size={13} /> Try Premium
          </button>
        )}
        {!session && (
          <button onClick={onSignIn} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
            <LogIn size={13} /> Sign in
          </button>
        )}
        <ProfileMenu session={session} profile={profile} isPremium={isPremium}
          a11y={a11y} setA11y={setA11y}
          onSignIn={onSignIn} onSignOut={onSignOut} onOpenPremium={onOpenPremium} onOpenFriends={onOpenFriends}
          isAdmin={isAdmin} onOpenAdmin={onOpenAdmin} onReplayTutorial={onOpenTutorial} onSendFeedback={onOpenFeedback} />
      </div>
    </header>
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

// Local-time YYYY-MM-DD (not toISOString, which is UTC and can be a day off).
function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The board exams PA (and med) students most often count down to. "Custom…"
// covers everything else (shelf exams, finals, quizzes) with a free-text name.
const EXAM_OPTIONS = [
  "PANCE", "PANRE", "EOR (End of Rotation)",
  "USMLE Step 1", "USMLE Step 2 CK", "USMLE Step 3",
  "COMLEX Level 1", "COMLEX Level 2-CE", "COMLEX Level 3",
  "MCAT",
];

function ExamCountdownBar({ examDate, examName, setExam }: any) {
  const [editing, setEditing] = useState(!examDate);
  const [draft, setDraft] = useState(examDate ?? "");
  const isListed = !examName || EXAM_OPTIONS.includes(examName);
  const [examPick, setExamPick] = useState(() => (examName ? (isListed ? examName : "custom") : "PANCE"));
  const [customName, setCustomName] = useState(isListed ? "" : examName ?? "");
  const todayStr = localTodayISO();
  const isPast = !!draft && draft < todayStr;

  const save = () => {
    if (!draft || isPast) return; // the exam can't be in the past
    const name = examPick === "custom" ? (customName.trim().slice(0, 60) || "exam") : examPick;
    setExam(draft, name);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} className="text-primary" />
          <span className="text-sm font-medium">Set your exam date</span>
          <InfoTip text="Pick your board exam — PANCE, EOR, USMLE, COMLEX, MCAT — or name your own. Roamly keeps a live day countdown at the top of the Focus tab: a little pressure, applied kindly." />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={examPick} onChange={(e) => setExamPick(e.target.value)} aria-label="Which exam"
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
            {EXAM_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
            <option value="custom">Custom…</option>
          </select>
          {examPick === "custom" && (
            <input value={customName} onChange={(e) => setCustomName(e.target.value)} maxLength={60}
              placeholder="Exam name (e.g. Cardio final)"
              className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 sm:flex-none sm:w-52" />
          )}
          <input type="date" value={draft} min={todayStr} onChange={(e) => setDraft(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          {isPast && <span className="w-full text-xs text-destructive sm:w-auto">Pick today or a future date.</span>}
          <button onClick={save} disabled={!draft || isPast}
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
  const label = examName || "exam";

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <CalendarClock size={16} className="shrink-0 text-primary" />
        <span className="text-sm">
          {days > 0 && <><span className="font-display text-lg font-semibold">{days}</span> day{days === 1 ? "" : "s"} until your <span className="font-medium">{label}</span></>}
          {days === 0 && `Your ${label} is today — good luck!`}
          {days < 0 && `Your ${label} date has passed`}
        </span>
      </div>
      <button onClick={() => setEditing(true)} className="shrink-0 text-xs text-muted-foreground underline">Change</button>
    </div>
  );
}

function NotificationToggle({ alerts }: any) {
  const soundToggle = (
    <button role="switch" aria-checked={alerts.soundEnabled} onClick={() => alerts.setSoundEnabled(!alerts.soundEnabled)}
      className="flex items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
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
    <><button onClick={alerts.requestPermission} className="flex items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"><Bell size={13} /> Enable notifications</button>{soundToggle}</>
  );
}

// A short explainer of the Pomodoro method at the top of the main page, so
// newcomers understand what the timer is doing (from user feedback). Dismissible
// and remembered; collapses to a small reopen link once dismissed.
function PomodoroExplainer() {
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
        It's a simple way to study without burning out: focus in short, timed blocks — classically <span className="font-medium text-foreground">25 minutes</span> — then take a <span className="font-medium text-foreground">5-minute break</span>. After about four blocks you take a longer break. The countdown keeps you honest during focus, and the breaks keep you fresh.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Just press <span className="font-medium text-foreground">Start</span> below to begin a block — or use <span className="font-medium text-foreground">Select timer</span> to pick a different rhythm.
      </p>
    </div>
  );
}

function FocusView({ method, methodId, setMethodId, timer, theme, tasks, activeTask, setActiveTask, custom, setCustom, isPremium, gateThen, examDate, examName, setExam, alerts, session, onSignIn, sounds, enterFocus, pipSupported, pipActive, onPopOut, onClosePip, embed, playEmbed, guardSolo, immersive, autoFlow, onToggleAutoFlow, onOpenTasks, onAdvertise, onGoPremium, countUp, onCompleteCountUp }: any) {
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
        <ExamCountdownBar key={`${examDate ?? "none"}|${examName ?? ""}`} examDate={examDate} examName={examName} setExam={setExam} />
      ) : (
        <SignInPrompt onSignIn={onSignIn} message="Sign in to track your exam countdown." />
      )}

      <section ref={timerRef} className="overflow-hidden rounded-3xl border border-border bg-card/80 p-6 shadow-sm backdrop-blur sm:p-8">
        <button onClick={() => setShowMethods(true)}
          className="mb-5 flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-2.5 text-sm transition hover:border-primary/40">
          <span className="flex items-center gap-2 font-medium"><Timer size={15} className="text-primary" /> Select timer</span>
          <span className="flex items-center gap-1 text-muted-foreground">{timerMode === "countup" ? "Count-up" : method.name} <ChevronDown size={14} /></span>
        </button>
        {timerMode === "pomodoro" ? (
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
                  // sound from the effect that fires after this handler.
                  if (!timer.running) { if (!guardSolo?.()) return; countUp.reset(); unlockAudio(); enterFocus?.(); } // Start also drops into focus mode
                  (timer.running ? timer.pause : timer.start)();
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
                className="flex items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                <Timer size={13} /> Focus mode
              </button>
              <InfoTip text="Focus mode fills your whole screen with the timer, your music, and your task list — Start opens it automatically, and this button gets you back in." />
              {pipSupported && (
                <>
                  <button onClick={() => (pipActive ? onClosePip?.() : onPopOut?.())}
                    className="flex items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                    <PictureInPicture2 size={13} /> {pipActive ? "Close pop-out" : "Pop out timer"}
                  </button>
                  <InfoTip text="Pop the timer into a small floating window that stays on top of other apps — so you can keep studying on the rest of your screen and still see the countdown. Desktop Chrome/Edge only." />
                </>
              )}
              <button onClick={onToggleAutoFlow}
                className={`flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-medium transition ${autoFlow ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                aria-pressed={autoFlow}>
                <Play size={13} /> Auto-flow {autoFlow ? "on" : "off"}
              </button>
              <InfoTip text="Auto-flow starts the next phase by itself — focus rolls into break and back without pressing Start. Turn it off to start each block yourself." />
              <NotificationToggle alerts={alerts} />
            </div>
          </div>
        </div>
        ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
          <div className="flex shrink-0 flex-col items-center lg:items-start">
            <span className="font-mono text-xs uppercase tracking-[0.25em]" style={{ color: theme.ring }}>Count-up</span>
            <TimeDisplay value={fmt(countUp.elapsedSeconds)} className="font-display text-7xl font-medium tracking-tight sm:text-8xl" />
            <span className="mt-1 text-sm text-muted-foreground">Stopwatch — no countdown</span>
          </div>

          <div className="flex flex-1 flex-col gap-5">
            <p className="text-sm text-muted-foreground">
              {task
                ? <>Time logs to <span className="text-foreground">{task.title}</span> ({task.tag}) when you stop &amp; save.</>
                : "Select a task below to link this session — or just run the clock."}
            </p>
            <div className="flex items-center gap-3">
              <button onClick={() => {
                if (!countUp.running) { if (!guardSolo?.()) return; timer.reset(); unlockAudio(); }
                (countUp.running ? countUp.pause : countUp.start)();
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

      <HealthyBreakActivities active={timer.phase !== "focus"} breakKey={`solo-main-${timer.phase}-${timer.completedFocus}`} />
      <AdBreakPrompt active={timer.phase !== "focus" && !isPremium} onAdvertise={onAdvertise} onGoPremium={onGoPremium} />

      <FocusSoundsPanel sounds={sounds} />

      <MusicPanel embed={embed} onPlay={playEmbed} active={!immersive} />

      {showMethods && (
        <Modal label="Timer method" onClose={() => setShowMethods(false)}
          cardClassName="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 font-display text-lg font-semibold">Timer method
                <InfoTip text="A method sets your rhythm: how long each focus block runs, how long breaks last, and how many blocks make a cycle. Pick short Sprints or go Deep — the timer handles the switching." />
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
                    className={`relative w-full rounded-2xl border p-3 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card/70 hover:border-primary/40"}`}>
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
                className={`relative w-full rounded-2xl border p-3 text-left transition ${timerMode === "countup" ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card/70 hover:border-primary/40"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Count-up timer</span>
                  <Timer size={13} className="text-primary" />
                </div>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">Stopwatch mode — no countdown. Time logs to your selected task when you stop &amp; save.</p>
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
                  <p className="text-sm text-muted-foreground">0 tasks queued — add what you'll study and it shows up here.</p>
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
        <div className="absolute right-0 top-11 z-50 w-64 rounded-2xl border border-border bg-card p-2 shadow-xl">
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
// the app owns this audio, so it can follow the timer perfectly.
function FocusSoundsPanel({ sounds }: any) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-primary" />
          <h2 className="font-display text-lg font-semibold">Focus sounds</h2>
        </div>
        <button onClick={sounds.toggle} disabled={!sounds.sound}
          aria-label={sounds.playing ? "Pause sound" : "Play sound"}
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-40">
          {sounds.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FOCUS_SOUNDS.map((s) => {
          const active = sounds.sound === s.id;
          return (
            <button key={s.id} onClick={() => sounds.choose(s.id)}
              className={`relative rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card/60 hover:border-primary/40"}`}>
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
    </div>
  );
}

// Controller for the ONE persistent streaming player (the mini-dock App
// renders at the root). Selecting a preset or pasting a link hands the target
// up to App via onPlay — the iframe itself lives in the dock, so it keeps
// playing across tab switches and pop-out timers instead of dying when this
// panel unmounts.
function MusicPanel({ embed, onPlay, active }: any) {
  const [service, setService] = useState<"spotify" | "apple">("spotify");
  const [spotifyCustomUrl, setSpotifyCustomUrl] = useState("");
  const [spotifyCustomError, setSpotifyCustomError] = useState(false);
  const [appleCustomUrl, setAppleCustomUrl] = useState("");
  const [appleCustomError, setAppleCustomError] = useState(false);

  const playSpotify = (target: { type: SpotifyEmbedType; id: string }, label: string) =>
    onPlay({ service: "spotify", src: toSpotifyEmbedSrc(target), height: embedHeight(target.type), label });
  const playApple = (target: { type: AppleMusicEmbedType; path: string }, label: string) =>
    onPlay({ service: "apple", src: toAppleEmbedSrc(target), height: appleEmbedHeight(target.type), label });

  // Show a ready-to-play embedded player by default (no click needed) so users
  // can see both Spotify and Apple Music are available without hunting for a
  // station first. Autoplay never starts without a user gesture, so this default
  // player doesn't hijack any built-in focus sound — it just sits there ready.
  const first = service === "spotify" ? SPOTIFY_PRESETS[0] : APPLE_MUSIC_PRESETS[0];
  const defaultEmbed = service === "spotify"
    ? { service: "spotify" as const, src: toSpotifyEmbedSrc({ type: (first as any).type, id: (first as any).spotifyId }), height: embedHeight((first as any).type), label: first.name }
    : { service: "apple" as const, src: toAppleEmbedSrc({ type: (first as any).type, path: (first as any).path }), height: appleEmbedHeight((first as any).type), label: first.name };
  const shown = embed ?? defaultEmbed;

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
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music size={16} className="text-primary" />
          <h2 className="font-display text-lg font-semibold">Music</h2>
        </div>
      </div>

      <div>
        <div className="mb-3 flex gap-1.5 rounded-xl border border-border bg-card/60 p-1">
          <button onClick={() => setService("spotify")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${service === "spotify" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            Spotify
          </button>
          <button onClick={() => setService("apple")}
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
              Couldn't read that link — paste a track, playlist, album, or artist URL.
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Tap a playlist above to load it into the player below — or paste your own link.
        </p>

        {active && (
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <iframe key={shown.src} src={shown.src} width="100%" height={Math.min(shown.height, 152)}
              style={{ border: "none" }} title={`${shown.service === "spotify" ? "Spotify" : "Apple Music"} player`}
              loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
          </div>
        )}
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

// Themed replacements for the old window.prompt() dialogs — same look as
// every other Roamly modal instead of a bare browser popup.
function TaskTitleModal({ task, onSave, onClose }: any) {
  const [draft, setDraft] = useState(task.title);
  const commit = () => { const v = draft.trim(); if (v) onSave(v); onClose(); };
  return (
    <Modal label="Edit task" onClose={onClose} cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
      <h3 className="font-display text-lg font-semibold">Edit task</h3>
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }} aria-label="Task title"
        className="mt-3 w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-full border border-border bg-card py-2 text-sm text-muted-foreground transition hover:border-primary/40">Cancel</button>
        <button onClick={commit} className="flex-1 rounded-full gradient-primary py-2 text-sm font-semibold text-white shadow-glow transition active:scale-95">Save</button>
      </div>
    </Modal>
  );
}

function TaskEstModal({ task, onPick, onClose }: any) {
  return (
    <Modal label="Focus sessions needed" onClose={onClose} cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
      <h3 className="font-display text-lg font-semibold">How many focus sessions?</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        “{task.title}” completes itself when it gets there{task.poms > 0 ? ` — ${task.poms} done so far` : ""}.
      </p>
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

function TasksView({ tasks, activeTask, setActiveTask, addTask, editTask, setTaskEst, toggleTask, removeTask, reorderTask, onFocusTask, session, onSignIn, tasksLoaded, profile, addImportedTasks, onSubscribe, onBuyCredits, guestLimit }: any) {
  const [draft, setDraft] = useState("");
  const [tag, setTag] = useState("");
  const [customTag, setCustomTag] = useState<string | null>(null); // non-null while typing a new subject
  const [showDone, setShowDone] = useState(false);
  const [editTarget, setEditTarget] = useState<Task | null>(null); // themed title editor
  const [estTarget, setEstTarget] = useState<Task | null>(null);   // themed sessions picker

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
  };

  const onRowPointerUp = () => {
    const p = press.current;
    const d = dragRef.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    if (d) {
      if (d.over !== d.from) reorderTask(d.id, d.over);
      justDragged.current = true;
      window.setTimeout(() => { justDragged.current = false; }, 80);
      setDrag(null);
    }
  };

  const onRowPointerCancel = () => {
    const p = press.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    if (dragRef.current) setDrag(null);
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
    addTask(draft.trim(), chosenTag);
    setDraft("");
    if (showCustom) { setTag(chosenTag); setCustomTag(null); }
  };

  const sorted = sortTasks(tasks);
  const open = sorted.filter((t: Task) => !t.done);
  const doneTasks = sorted.filter((t: Task) => t.done);
  const groupNames: string[] = [...new Set<string>(open.map((t: Task) => t.tag))];
  // Subject groups themselves can be reordered (▲▼ on each header); the order
  // persists on this device. Unlisted subjects keep their natural position.
  const [tagOrder, setTagOrder] = useState<string[]>(() => { try { return JSON.parse(loadPref("roamly-tag-order") ?? "[]") as string[]; } catch { return []; } });
  const groupRank = (g: string) => { const i = tagOrder.indexOf(g); return i === -1 ? 1000 + groupNames.indexOf(g) : i; };
  const orderedGroupNames = [...groupNames].sort((a, b) => groupRank(a) - groupRank(b));
  const moveGroup = (g: string, dir: -1 | 1) => {
    const cur = orderedGroupNames.slice();
    const i = cur.indexOf(g); const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    setTagOrder(cur);
    savePref("roamly-tag-order", JSON.stringify(cur));
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Tasks</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        Queue what you'll study. Pick one to focus on.
        <InfoTip text="Each task is sized in focus sessions — new ones need just 1. The counter shows progress (1/3 = 1 session done of 3); tap it to resize a bigger task, and it completes itself when the sessions are done. Finishing a focus block counts a session for whichever task you're focusing. Drag ⋮⋮ to reorder within a subject; ▲▼ moves whole subjects." />
      </p>
      {tasks.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{doneTasks.length} of {tasks.length} done</span>
            {doneTasks.length === tasks.length && <span className="text-roamly-green">All clear 🎉</span>}
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}>
            <div className="h-full rounded-full bg-roamly-green" style={{ width: `${tasks.length ? (doneTasks.length / tasks.length) * 100 : 0}%`, transition: "width 0.4s ease" }} />
          </div>
        </div>
      )}
      {!session && (
        <div className="mt-4">
          <>
            <SignInPrompt onSignIn={onSignIn} message={`Guest tasks stay on this device (${tasks.length}/${guestLimit}). Sign in to sync across devices.`} />
            <p className="mt-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
              <Crown size={12} className="mr-1 inline text-primary" />
              Signed-in users can also generate tasks with AI — upload lecture notes, slides, or
              even photos of handwritten pages and Roamly turns them into a task list (3 uploads/month free, 10 with Premium).
            </p>
          </>
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
              placeholder={noSubjectsYet ? "Subject — e.g. Pharm" : "New subject"} maxLength={24} autoFocus={customTag !== null} aria-label="New subject name"
              className="w-32 rounded-xl border border-primary bg-card px-3 py-3 text-sm outline-none ring-2 ring-primary/20" />
            {!noSubjectsYet && (
              <button onClick={() => setCustomTag(null)} aria-label="Cancel new subject"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:text-foreground">
                <X size={15} />
              </button>
            )}
          </span>
        ) : (
          <select value={selectedTag} aria-label="Subject"
            onChange={(e) => (e.target.value === "__new__" ? setCustomTag("") : setTag(e.target.value))}
            className="rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
            {tags.map((t) => <option key={t}>{t}</option>)}
            <option value="__new__">＋ New subject…</option>
          </select>
        )}
        <button onClick={add} disabled={!session && tasks.length >= guestLimit} aria-label="Add task" className="grid w-12 shrink-0 place-items-center rounded-xl gradient-primary text-white shadow-glow transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={20} /></button>
      </div>
      {!session && tasks.length >= guestLimit && <p role="status" className="mt-2 text-sm text-muted-foreground">You reached the 5-task guest limit. Sign in to create and sync more tasks.</p>}

      {session && !tasksLoaded && (
        <p className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-center text-sm text-muted-foreground">
          Loading your tasks…
        </p>
      )}

      {tasksLoaded && open.length === 0 && tasks.length > 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-center text-sm text-muted-foreground">
          Everything's done — add your next study task above.
        </p>
      )}

      {(!session || tasksLoaded) && orderedGroupNames.map((g, gi) => {
        const groupTasks = open.filter((t: Task) => t.tag === g);
        const groupIds = groupTasks.map((t: Task) => t.id);
        const c = tagColor(g);
        return (
          <section key={g} className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: c }} /> {g} · {groupTasks.length}
              </h2>
              <span className="flex items-center gap-0.5">
                <button onClick={() => moveGroup(g, -1)} disabled={gi === 0} aria-label={`Move ${g} up`}
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-primary/10 hover:text-primary disabled:opacity-30"><ChevronUp size={13} /></button>
                <button onClick={() => moveGroup(g, 1)} disabled={gi === orderedGroupNames.length - 1} aria-label={`Move ${g} down`}
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-primary/10 hover:text-primary disabled:opacity-30"><ChevronDown size={13} /></button>
              </span>
            </div>
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
                      <button onClick={() => { if (!justDragged.current) setActiveTask(t.id); }} className="min-w-0 flex-1 basis-52 text-left">
                        <span className="block min-w-0 break-words text-sm leading-snug">{t.title}</span>
                        <span className="mt-1 flex items-center gap-2">
                          <TagPill tag={t.tag} />
                          {active && (
                            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              <Timer size={10} /> Focusing
                            </span>
                          )}
                        </span>
                      </button>
                      <div data-nodrag className="ml-auto flex shrink-0 items-center gap-0.5">
                        {!active && (
                          <button onClick={() => onFocusTask(t.id)} aria-label={`Focus on ${t.title}`}
                            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary">
                            <Play size={13} />
                          </button>
                        )}
                        <button onClick={() => setEditTarget(t)} aria-label={`Edit ${t.title}`}
                          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary">
                          <Pencil size={13} />
                        </button>
                        <button data-nodrag onClick={() => setEstTarget(t)} title="Focus sessions done / planned — click to change"
                          className="rounded-md px-1.5 py-0.5 text-center font-mono text-xs text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                          aria-label={`${t.poms} of ${t.est} focus sessions done for ${t.title} — change estimate`}>
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

      {editTarget && <TaskTitleModal task={editTarget} onSave={(title: string) => editTask(editTarget.id, title)} onClose={() => setEditTarget(null)} />}
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
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%`, transition: "width 0.4s ease" }} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm text-muted-foreground">Daily goal</span>
        <NumberField value={dailyGoal} unit="min" min={5} max={600} label="Daily goal" onChange={setDailyGoal} />
      </div>
    </div>
  );
}

function AnalyticsView({ isPremium, onUpsell, streak, todayMinutes, dailyGoal, setDailyGoal, session, onSignIn, sessions, tasks, studyEvents, plannedSessions, onCreatePlan, onUpdatePlan }: any) {
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
  const doneTasks = (tasks as Task[]).filter((t) => t.done).length;

  // Subject split from real completed pomodoros per subject.
  const pomsByTag = new Map<string, number>();
  for (const t of tasks as Task[]) if (t.poms > 0) pomsByTag.set(t.tag, (pomsByTag.get(t.tag) ?? 0) + t.poms);
  const pomsTotal = [...pomsByTag.values()].reduce((a, b) => a + b, 0);
  const subjectSplit = [...pomsByTag.entries()]
    .map(([name, poms]) => ({ name, value: Math.round((poms / Math.max(1, pomsTotal)) * 100), color: tagColor(name) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Achievements are computed live from the same data — they unlock themselves
  // as the user actually studies.
  const hrs = Math.floor(totalMin60 / 60);
  const achievements = [
    { name: "First focus", hint: "Finish one focus session", done: totalMin60 > 0 },
    { name: "3-day streak", hint: `Study 3 days in a row (${Math.min(streak, 3)}/3)`, done: streak >= 3 },
    { name: "7-day streak", hint: `Study 7 days in a row (${Math.min(streak, 7)}/7)`, done: streak >= 7 },
    { name: "Century day", hint: `100 focus minutes in a day (best ${bestDayEver}m)`, done: bestDayEver >= 100 },
    { name: "Deep day", hint: `3 hours in one day (best ${Math.floor(bestDayEver / 60)}h)`, done: bestDayEver >= 180 },
    { name: "10 hours in", hint: `${Math.min(hrs, 10)}/10 hours of total focus`, done: hrs >= 10 },
    { name: "25 hours in", hint: `${Math.min(hrs, 25)}/25 hours of total focus`, done: hrs >= 25 },
    { name: "Task finisher", hint: `Complete 10 tasks (${Math.min(doneTasks, 10)}/10)`, done: doneTasks >= 10 },
  ];
  const earned = achievements.filter((a) => a.done).length;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-3xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">Live from your timer — every session you finish counts here.</p>

      <div className="mt-6">
        {session ? (
          <DailyGoalCard streak={streak} todayMinutes={todayMinutes} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal} />
        ) : (
          <><DailyGoalCard streak={streak} todayMinutes={todayMinutes} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal} /><div className="mt-3"><SignInPrompt onSignIn={onSignIn} message="As a guest, analytics track only what you do in this browser, on this device — nothing is saved to an account. Create a free account to keep your history, streaks, and stats everywhere you sign in." /></div></>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="This week" value={`${Math.floor(weekMin / 60)}h ${weekMin % 60}m`} />
        <Stat label="Streak" value={`${streak} day${streak === 1 ? "" : "s"}`} />
        <Stat label="Best day (7d)" value={bestWeek.min > 0 ? bestWeek.day : "—"} sub={bestWeek.min > 0 ? `${bestWeek.min}m` : "No focus yet"} />
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

      <StudyInsights events={studyEvents} daily={sessions} tasks={tasks} plans={plannedSessions} signedIn={!!session} onCreatePlan={onCreatePlan} onUpdatePlan={onUpdatePlan} />

      <div className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Achievements</h2>
          <span className="text-xs text-muted-foreground">{earned}/{achievements.length} earned</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {achievements.map((a) => (
            <div key={a.name} className={`rounded-xl border p-3 ${a.done ? "border-primary/50 bg-primary/5" : "border-border bg-card/60 opacity-70"}`}>
              <div className="flex items-center gap-1.5">
                {a.done ? <Check size={13} className="shrink-0 text-roamly-green" /> : <Lock size={12} className="shrink-0 text-muted-foreground" />}
                <span className="truncate text-xs font-semibold">{a.name}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{a.hint}</p>
            </div>
          ))}
        </div>
      </div>

      {subjectSplit.length > 0 && (
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
      )}

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
  const perks = ["10 AI note uploads each month", "Full analytics history", "Host up to 3 live study rooms", "Voice chat during room breaks", "Premium UI themes", "PANCE & Marathon methods", "Spotify & Apple Music embeds"];
  const credits = (profile?.ai_credits as number | undefined) ?? 0;
  // [feature, free, premium] — strings render as text, booleans as ✓/—.
  const compare: [string, string | boolean, string | boolean][] = [
    ["Price", "$0", "$3 monthly or $30 yearly"],
    ["AI note uploads", "3 a month", "10 a month"],
    ["Extra upload credits", "Buy anytime", "Buy anytime"],
    ["Timer methods", "Core methods", "+ PANCE Drill & Marathon"],
    ["Study rooms", "Join any room", "Join + host up to 3"],
    ["Voice chat during breaks", false, true],
    ["Analytics", "This week", "Full history"],
    ["Themes", "Core themes", "All themes"],
    ["Spotify & Apple Music", false, true],
  ];
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  // Stripe Billing Portal: update card, view invoices, or cancel. Cancelling
  // flows through the webhook, which reverts the account to free automatically.
  const openPortal = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const token = await getAccessToken();
      if (!token) { setPortalLoading(false); return; }
      const res = await fetch("/api/create-portal-session", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setPortalError(data.error ?? "Couldn't open the billing portal — try again.");
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
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card/70">
          <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-3 border-b border-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>What you get</span><span>Free</span><span className="text-primary">Premium</span>
          </div>
          {compare.map(([feature, free, prem]) => (
            <div key={feature} className="grid grid-cols-[1.4fr_1fr_1fr] items-center gap-x-3 border-b border-border/50 px-4 py-2 text-sm last:border-b-0">
              <span className="min-w-0 text-muted-foreground">{feature}</span>
              <span className="min-w-0 text-xs">
                {free === true ? <Check size={15} className="text-roamly-green" /> : free === false ? <span className="text-muted-foreground/50">—</span> : free}
              </span>
              <span className="min-w-0 text-xs font-medium">
                {prem === true ? <Check size={15} className="text-roamly-green" /> : prem === false ? <span className="text-muted-foreground/50">—</span> : prem}
              </span>
            </div>
          ))}
        </div>
      )}

      {isPremium && (
        <div className="mt-6 rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-medium"><Crown size={15} className="text-primary" /> Premium is active — thanks for supporting Roamly.</p>
          {hasStripeSubscription ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">Manage billing below: update your card, see invoices, or cancel. If you cancel (or a payment stops), your account automatically returns to the free tier at the end of the paid period.</p>
              <button onClick={openPortal} disabled={portalLoading}
                className="mt-4 rounded-full border border-border bg-card px-5 py-2 text-sm font-medium transition hover:border-primary/40 disabled:opacity-60">
                {portalLoading ? "Opening…" : "Manage subscription"}
              </button>
              {portalError && <p className="mt-2 text-xs text-destructive">{portalError}</p>}
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Premium comes from {profile?.premium_source === "trial" ? "your 30-day trial" : profile?.premium_source === "credit_purchase" ? "a credit purchase" : "an account grant"}.
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
                <p className="mt-0.5 text-xs text-primary">Save $6 annually</p>
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
            <p className="mt-2 text-center text-xs text-muted-foreground">Secure billing via Stripe. Cancel anytime. New verified accounts receive a 30-day no-card trial.</p>
          </div>
        </div>
      )}

      {/* Credit packs — one-time purchases, for subscribers and free users alike. */}
      <div className="mt-6 rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Plus size={15} className="text-primary" /> Upload credits — no subscription needed
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Extra AI note uploads you buy once. They never expire and are used automatically after your monthly allowance
          ({isPremium ? "10 with Premium" : "3 free"}) runs out.
          {session && <span className="font-medium text-foreground"> You have {credits} credit{credits === 1 ? "" : "s"}.</span>}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { id: "small" as const, credits: 2, price: "$1", premium: "3 days Premium" },
            { id: "large" as const, credits: 5, price: "$3", premium: "7 days Premium" },
          ].map((p) => (
            <div key={p.id} className="rounded-2xl border border-border bg-card/70 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">{p.credits} uploads</span>
                <span className="font-display text-xl font-bold">{p.price}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Includes {p.premium}; never shortens an existing entitlement.</p>
              <button onClick={() => onSubscribe(p.id)} disabled={checkoutLoading}
                className="mt-3 w-full rounded-full border border-primary/50 bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 active:scale-95 disabled:opacity-60">
                {session ? (checkoutLoading ? "Redirecting…" : "Buy with Stripe") : "Sign in to buy"}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">One-time purchase · credits never expire · secure checkout via Stripe.</p>
      </div>
    </div>
  );
}


function FocusTasksCard({ tasks, activeTask, setActiveTask, toggleTask }: any) {
  // A just-completed task lingers briefly in its "done" state before dropping
  // out, so checking it off gives visible feedback instead of a vanishing row.
  const [justDone, setJustDone] = useState<string | null>(null);
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

  if (tasks.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Studying</span>
      {open.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Check size={15} className="shrink-0 text-roamly-green" /> All tasks done — ride out the timer or enjoy your break.
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {open.map((t: Task) => (
            <div key={t.id}
              className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 transition ${t.done ? "border-roamly-green/40 bg-card/60" : activeTask === t.id ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:border-primary/40"}`}>
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
        <p className="mt-1.5 text-sm text-muted-foreground">Unlock premium methods, themes, full analytics, 10 AI note uploads a month, and hosting your own study rooms.</p>
        <button onClick={onUpgrade} className="mt-5 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95">Try Premium free</button>
        {onBuyCredits && (
          <button onClick={onBuyCredits} className="mt-2 w-full rounded-full border border-primary/50 bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20">
            Or buy AI upload credits — no subscription
          </button>
        )}
        <button onClick={onClose} className="mt-2 w-full rounded-full py-2 text-sm text-muted-foreground">Maybe later</button>
    </Modal>
  );
}

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
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg">
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
