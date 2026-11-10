// One place for every timing. Seconds → frames at 30 fps.
export const FPS = 30;
export const DURATION = 50 * FPS;
export const s = (sec: number) => Math.round(sec * FPS);

// Voice-over (xAI TTS, voice "eve"), trimmed of silence and normalized. at = start time in seconds.
export const VO = [
  { id: "f01", at: 0.45, dur: 1.19, text: "Your exam has a date." },
  { id: "f00", at: 2.55, dur: 3.7, text: "Meet Roamly Flow, the focus timer built for P A school." },
  { id: "f02", at: 6.75, dur: 3.05, text: "Add it, or create your own, and watch the countdown." },
  { id: "f03", at: 12.6, dur: 2.68, text: "Pick a classic timer, or count up instead." },
  { id: "f04", at: 17.4, dur: 3.41, text: "Hit start, and focus mode clears everything but your task." },
  { id: "f05", at: 23.3, dur: 4.17, text: "Your pets and garden keep you company. Or switch them off in settings." },
  { id: "f06", at: 29.8, dur: 3.24, text: "Play our study channels, or connect Spotify and Apple Music." },
  { id: "f07", at: 35.4, dur: 2.88, text: "On your computer, pop the timer out over your notes." },
  { id: "f08", at: 40.9, dur: 1.81, text: "And make it yours with color themes." },
  { id: "f09", at: 44.9, dur: 2.31, text: "Roamly Flow. Study with flow." },
  { id: "f10", at: 47.45, dur: 2.17, text: "Start free at Roamly Flow dot com." },
];

// Sound effects (seconds), synthesized by tools/make-sfx.py.
type Sfx = { at: number; id: "click" | "whoosh" | "pop" | "chime" | "tick"; vol?: number };
export const SFX: Sfx[] = [
  { at: 2.2, id: "whoosh", vol: 0.45 }, { at: 3.1, id: "chime", vol: 0.45 },
  { at: 5.95, id: "whoosh", vol: 0.5 },
  { at: 7.6, id: "click" }, { at: 8.9, id: "click" }, { at: 10.1, id: "click" }, { at: 10.2, id: "pop", vol: 0.6 },
  { at: 11.95, id: "whoosh", vol: 0.45 },
  { at: 13.55, id: "click" }, { at: 14.75, id: "click" }, { at: 15.6, id: "click" },
  { at: 16.95, id: "whoosh", vol: 0.45 },
  { at: 18.1, id: "click" }, { at: 18.3, id: "whoosh", vol: 0.7 }, { at: 18.45, id: "chime", vol: 0.5 },
  { at: 25.8, id: "whoosh", vol: 0.4 }, { at: 26.9, id: "click" }, { at: 27.8, id: "click" },
  { at: 29.35, id: "whoosh", vol: 0.45 }, { at: 33.5, id: "click" },
  { at: 36.0, id: "click" }, { at: 36.3, id: "whoosh", vol: 0.6 }, { at: 36.85, id: "pop", vol: 0.7 },
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i): Sfx => ({ at: 40.65 + i * 0.3, id: "tick", vol: 0.5 })),
  { at: 44.35, id: "whoosh", vol: 0.55 }, { at: 45.0, id: "chime", vol: 0.6 }, { at: 47.4, id: "pop", vol: 0.5 },
];
