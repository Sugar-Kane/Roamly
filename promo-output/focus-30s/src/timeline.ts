// One place for every timing. Seconds → frames at 30 fps.
export const FPS = 30;
export const DURATION = 30 * FPS;
export const s = (sec: number) => Math.round(sec * FPS);

// Voice-over (xAI TTS, voice "eve"), trimmed of silence. at = start time in seconds.
export const VO = [
  { id: "f01", at: 0.35, dur: 1.19, text: "Your exam has a date." },
  { id: "f02", at: 1.75, dur: 3.05, text: "Add it, or create your own, and watch the countdown." },
  { id: "f03", at: 5.1, dur: 2.68, text: "Pick a classic timer, or count up instead." },
  { id: "f04", at: 8.05, dur: 3.41, text: "Hit start, and focus mode clears everything but your task." },
  { id: "f05", at: 11.75, dur: 4.17, text: "Your pets and garden keep you company. Or switch them off in settings." },
  { id: "f06", at: 16.2, dur: 3.24, text: "Play our study channels, or connect Spotify and Apple Music." },
  { id: "f07", at: 19.7, dur: 2.88, text: "On your computer, pop the timer out over your notes." },
  { id: "f08", at: 22.85, dur: 1.81, text: "And make it yours with color themes." },
  { id: "f09", at: 25.4, dur: 2.31, text: "Roamly Flow. Study with flow." },
];

// Scene boundaries (seconds).
export const SCENES = {
  exams: [0, 5.0],
  timers: [5.0, 8.0],
  focus: [8.0, 14.0],
  customize: [14.0, 16.2],
  music: [16.2, 19.7],
  pip: [19.7, 22.9],
  themes: [22.9, 25.3],
  cta: [25.3, 30],
} as const;

// Sound effects (seconds), synthesized by tools/make-sfx.py.
export const SFX: { at: number; id: "click" | "whoosh" | "pop" | "chime" | "tick"; vol?: number }[] = [
  { at: 1.45, id: "whoosh", vol: 0.5 },
  { at: 2.35, id: "click" }, { at: 3.15, id: "click" }, { at: 3.85, id: "click" }, { at: 3.95, id: "pop", vol: 0.6 },
  { at: 4.95, id: "whoosh", vol: 0.45 },
  { at: 5.95, id: "click" }, { at: 6.7, id: "click" },
  { at: 7.95, id: "whoosh", vol: 0.45 },
  { at: 8.6, id: "click" }, { at: 8.85, id: "whoosh", vol: 0.7 }, { at: 9.0, id: "chime", vol: 0.5 },
  { at: 14.0, id: "whoosh", vol: 0.4 }, { at: 14.75, id: "click" }, { at: 15.35, id: "click" },
  { at: 16.15, id: "whoosh", vol: 0.45 }, { at: 18.65, id: "click" },
  { at: 20.15, id: "click" }, { at: 20.55, id: "whoosh", vol: 0.6 }, { at: 20.95, id: "pop", vol: 0.7 },
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ at: 22.95 + i * 0.19, id: "tick" as const, vol: 0.5 })),
  { at: 25.25, id: "whoosh", vol: 0.55 }, { at: 25.9, id: "chime", vol: 0.6 },
];
