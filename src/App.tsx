import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Timer, ListChecks, BarChart3, Users, Check, Crown, Play, Pause, SkipForward, X, ChevronRight, PictureInPicture2, Sprout, Moon, PawPrint, PartyPopper } from "lucide-react";
import { METHODS, THEMES, sortTasks, type Task } from "./data";
import { useTimer, fmt, type Phase } from "./useTimer";
import { FOCUS_SOUNDS, startFocusSound, stopFocusSound, setFocusVolume, focusSoundActive, unlockAudio, releaseAudioSession, duckFocusSound, setOnPlaybackStart, playCelebration, type FocusSoundId } from "./focusSounds";
import { SPOTIFY_PRESETS, toEmbedSrc as toSpotifyEmbedSrc, embedHeight } from "./spotify";
import { APPLE_MUSIC_PRESETS, toEmbedSrc as toAppleEmbedSrc, embedHeight as appleEmbedHeight } from "./appleMusic";
import { supabase, arrivedViaEmailLink } from "./supabaseClient";
import { fetchProfile, updateGoalAndExam, recordFocusSession, fetchRecentSessions, fetchStudyEvents, fetchPlannedStudySessions, createPlannedStudySession, updatePlannedStudySession, deletePlannedStudySession, getAccessToken, fetchTasks, createTask, updateTask, deleteTask, checkIsAdmin, migrateGuestDataToAccount, fetchExamSchedules, createExamSchedule, updateExamSchedule, deleteExamSchedule, type ExamSchedule, type PlannedStudyUpdate, type Profile } from "./db";
import { addSession, computeStreak, minutesToday, dateKey, type FocusSession } from "./streaks";
import { track, setTrackUser } from "./track";
import { loadPref, savePref } from "./storage";
import { FeedbackModal } from "./Feedback";
import { useEndOfPhaseAlerts } from "./useEndOfPhaseAlerts";
import { AuthPanel, SetPasswordModal } from "./Auth";
import { loadA11y, type A11ySettings } from "./ProfileMenu";
import { RoomsLive } from "./RoomsLive";
import { FocusMode, CompactSounds } from "./FocusMode";
import { PipTimer } from "./PipTimer";
import { useDocumentPip, applyThemeToPip } from "./useDocumentPip";
import { useCountUpTimer } from "./useCountUpTimer";
import { Tutorial } from "./Tutorial";
import { AdminView } from "./Admin";
import { FriendsModal } from "./Friends";
import { GUEST_TASK_LIMIT, loadGuestSessions, loadGuestTasks, saveGuestSessions, saveGuestTasks, clearMigratedGuestData } from "./guestData";
import { loadGuestStudyEvents, newStudyEvent, saveGuestStudyEvents, type PlannedStudyDraft, type PlannedStudySession, type StudyEvent } from "./release3";
import { computeLocalGamification, fetchGamification, syncGamification, setPetActive, setRewardActive, stageProps, type Gamification, type GamSyncResult } from "./gamification";
import { GamificationView, UnlockToast } from "./GamificationView";
import { usePetSleep } from "./usePetSleep";
const PetStage = lazy(() => import("./PetCanvas").then((m) => ({ default: m.PetStage })));
import { useFocusMotivation, buildMotivationContext } from "./useFocusMotivation";
import { ConfettiBurst } from "./Confetti";
import { AdBreakPrompt, AdSubmitModal } from "./AdBreak";
import type { Session } from "@supabase/supabase-js";

// View type, tab labels, and URL↔view helpers moved to ./appTypes so the
// extracted view files can share them without importing App.
import { type View, VIEW_LABELS, viewFromPath } from "./appTypes";
// Sub-components extracted out of this file (behavior unchanged, props typed).
import { OfflineBanner, Header, GardenLock, Upsell, BottomNav } from "./commonUi";
import { MusicPanel, StreamingPlayer, MusicDock } from "./musicControls";
import { ConfirmModal } from "./taskModals";
import { FocusView, FocusTasksCard } from "./views/FocusView";
import { TasksView } from "./views/TasksView";
import { AnalyticsView } from "./views/AnalyticsView";
import { PremiumView } from "./views/PremiumView";

// A count-up session shorter than this isn't offered for saving — a few
// seconds from an accidental start is not real study time.
const MIN_COUNTUP_SAVE_SECONDS = 60;

export default function App() {
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname));
  const [immersive, setImmersive] = useState(false); // personal focus-mode takeover
  const [methodId, setMethodId] = useState("classic");
  const [themeId, setThemeId] = useState("coffee");
  const [tasks, setTasks] = useState<Task[]>(loadGuestTasks);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [activeTask, setActiveTask] = useState<string | null>(() => loadGuestTasks()[0]?.id ?? null);
  const [estimateReachedTask, setEstimateReachedTask] = useState<string | null>(null);
  const [autoCompleteEstimates, setAutoCompleteEstimates] = useState(() => loadPref("roamly-auto-complete-estimates") !== "0");
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
  // The mini-player can be dismissed entirely; reopened from the Music panel.
  // Closing only hides it (opacity/inert like `hidden`), so playback continues.
  const [dockClosed, setDockClosed] = useState(() => loadPref("roamly-dock-closed") === "1");
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
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(pack ? { pack } : { plan }),
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
    document.title = view === "focus" ? "Roamly Focus. Study timer for PA students" : `Roamly Focus · ${VIEW_LABELS[view]}`;
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
          onProfileChange={setProfile}
          onSignIn={onSignIn} onSignOut={onSignOut}
          onOpenRoom={openRoomFromNotification} onOpenFriends={openFriends} onOpenPlannedStudy={() => setView("tasks")}
          a11y={a11y} setA11y={setA11y} onOpenPremium={() => setView("premium")}
          confettiOn={confettiOn} onToggleConfetti={toggleConfetti}
          isAdmin={isAdmin} onOpenAdmin={() => setView("admin")}
          onOpenTutorial={() => setShowTutorial(true)}
          themeId={themeId} setThemeId={changeTheme}
          onGoHome={() => setView("focus")}
          onOpenFeedback={() => (session ? setShowFeedback(true) : setShowAuth(true))} />
        {view !== "focus" && (
          <nav aria-label="Breadcrumb" className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <button onClick={() => setView("focus")} className="transition hover:text-foreground">Roamly</button>
            <ChevronRight size={12} aria-hidden="true" />
            <span className="font-medium text-foreground" aria-current="page">{VIEW_LABELS[view]}</span>
          </nav>
        )}
        <main className="mt-8 flex-1">
          {view === "focus" && (
            <FocusView method={method} methodId={methodId} setMethodId={setMethodId} timer={timer} theme={theme}
              tasks={tasks} activeTask={activeTask} setActiveTask={setActiveTask}
              custom={custom} setCustom={setCustom}
              isPremium={isPremium} gateThen={gateThen}
              exams={examSchedules} addExam={addExam} editExam={editExam} removeExam={removeExam} alerts={alerts}
              embed={embed} shownEmbed={shownEmbed} playEmbed={playEmbed}
              embedStopSignal={embedStopSignal} onEmbedPlaying={onEmbedPlaying} runSolo={runSolo}
              autoFlow={autoFlow} onToggleAutoFlow={toggleAutoFlow} onOpenTasks={() => setView("tasks")}
              onAdvertise={() => (session ? setShowAd(true) : onSignIn())} onGoPremium={() => setShowUpsell(true)}
              countUp={countUp} onCompleteCountUp={completeCountUp}
              session={session} onSignIn={onSignIn} sounds={sounds}
              enterFocus={() => { setImmersive(true); track("focus_mode_enter"); }}
              pipSupported={pipSupported} pipActive={!!pipWindow}
              onPopOut={() => openPip().then((pip) => { if (pip) track("pip_open"); })} onClosePip={closePip}
              companions={petStageNode} showCompanions={showCompanions} petsAsleep={petSleep.asleep} onToggleSleep={toggleSleep}
              companionsOn={companionsOn} onToggleCompanions={toggleCompanions}
              confettiOn={confettiOn} onToggleConfetti={toggleConfetti}
              dockClosed={dockClosed} onReopenDock={reopenDock}
              motivation={motivation} />
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
              <AnalyticsView isPremium={isPremium} onUpsell={() => setShowUpsell(true)}
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
            session ? (
              <GamificationView gamification={gamification} session={session} reduceMotion={a11y.reduceMotion}
                onSignIn={onSignIn} onToggle={onToggleCompanion}
                companionsOn={companionsOn} onToggleCompanions={toggleCompanions} />
            ) : (
              <GardenLock onSignIn={onSignIn} />
            )
          )}
          {view === "premium" && (
            <PremiumView isPremium={isPremium} session={session} profile={profile} onSubscribe={startCheckout}
              checkoutLoading={checkoutLoading} checkoutError={checkoutError} />
          )}
          {view === "admin" && <AdminView isAdmin={isAdmin} />}
        </main>
      </div>
      <BottomNav nav={nav} view={view} setView={setView} />
      {/* Above the focus-mode overlay (z-120) and modals; pointer-events none. */}
      <ConfettiBurst burst={confettiBurst} reduceMotion={a11y.reduceMotion} enabled={confettiOn} />
      <MusicDock shown={shownEmbed} minimized={dockMin} onToggleMin={toggleDockMin} onPickService={pickDockService} onClose={closeDock}
        hidden={view !== "focus" || immersive || !!pipWindow || dockClosed}
        stopSignal={embedStopSignal} onPlaying={onEmbedPlaying} />
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
            {pipSupported && (
              <button onClick={() => (pipWindow ? closePip() : openPip().then((pip) => { if (pip) track("pip_open", "focus_mode"); }))}
                className={`grid h-12 w-12 place-items-center rounded-2xl border transition ${pipWindow ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                aria-pressed={!!pipWindow}
                aria-label={pipWindow ? "Close pop-out timer" : "Pop out timer"}>
                <PictureInPicture2 size={18} />
              </button>
            )}
            <button onClick={toggleAutoFlow} aria-pressed={autoFlow}
              className={`flex h-12 items-center rounded-2xl border px-4 text-xs font-medium transition ${autoFlow ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
              Auto-flow {autoFlow ? "on" : "off"}
            </button>
            {/* Always visible (even when pets are hidden) so there is always a
                way to bring them back. Reuses the single companions pref. */}
            <button onClick={toggleCompanions} aria-pressed={companionsOn}
              aria-label={companionsOn ? "Hide pets during focus" : "Show pets during focus"}
              className={`flex h-12 items-center gap-1.5 rounded-2xl border px-4 text-xs font-medium transition ${companionsOn ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
              <PawPrint size={14} /> Pets {companionsOn ? "on" : "off"}
            </button>
            <button onClick={toggleConfetti} aria-pressed={confettiOn}
              aria-label={confettiOn ? "Turn completion confetti off" : "Turn completion confetti on"}
              className={`flex h-12 items-center gap-1.5 rounded-2xl border px-4 text-xs font-medium transition ${confettiOn ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
              <PartyPopper size={14} /> Confetti {confettiOn ? "on" : "off"}
            </button>
            {showCompanions && (
              <button onClick={toggleSleep} aria-pressed={petSleep.asleep}
                className={`flex h-12 items-center gap-1.5 rounded-2xl border px-4 text-xs font-medium transition ${petSleep.asleep ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
                <Moon size={14} /> {petSleep.asleep ? "Wake pets" : "Too distracting"}
              </button>
            )}
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
            <div className="w-full rounded-2xl border border-border bg-card/70 p-3"><CompactSounds sounds={sounds} /></div>
            <MusicPanel embed={embed} shown={shownEmbed} onPlay={playEmbed} showPlayer stopSignal={embedStopSignal} onPlaying={onEmbedPlaying} />
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
          }
          extra={<StreamingPlayer shown={shownEmbed} compact plain stopSignal={embedStopSignal} />} />,
        pipWindow.document.body
      )}
      {/* The pop-out is a separate document, so the main confetti canvas can't
          reach it. Mount a second burst pointed at the PiP window, driven by
          the same counter, so a focus block that finishes while the user is
          watching the pop-out still celebrates there. */}
      {pipWindow && !roomActive && createPortal(
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

