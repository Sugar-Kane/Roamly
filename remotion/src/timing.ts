/**
 * The storyboard's single source of truth for scene lengths.
 *
 * Scene boundaries are expressed in seconds because the brief is written in
 * seconds; everything downstream (Series sequences, the SRT writer, the shot
 * list) derives from this array so the video and its captions can never
 * disagree about when a scene starts.
 */

export const FPS = 30;
export const TOTAL_SECONDS = 60;
export const TOTAL_FRAMES = FPS * TOTAL_SECONDS;

/** Cross-dissolve length between scenes, per the brief. */
export const TRANSITION_FRAMES = 12;

export type SceneId =
  | "feeling"
  | "timer"
  | "methods"
  | "upload"
  | "rooms"
  | "breaks"
  | "progress"
  | "close";

export type SceneSpec = {
  id: SceneId;
  /** Human label used in the shot list and Studio. */
  title: string;
  /** Inclusive start second, from the storyboard. */
  from: number;
  /** Exclusive end second. */
  to: number;
};

export const SCENES: SceneSpec[] = [
  { id: "feeling", title: "The feeling", from: 0, to: 7 },
  { id: "timer", title: "The timer", from: 7, to: 16 },
  { id: "methods", title: "The methods", from: 16, to: 24 },
  { id: "upload", title: "AI from your notes", from: 24, to: 34 },
  { id: "rooms", title: "You're not studying alone", from: 34, to: 44 },
  { id: "breaks", title: "Breaks without guilt", from: 44, to: 50 },
  { id: "progress", title: "Progress you can see", from: 50, to: 56 },
  { id: "close", title: "Close", from: 56, to: 60 },
];

export const sceneFrames = (s: SceneSpec) => Math.round((s.to - s.from) * FPS);

/**
 * Scenes are laid out back-to-back and each one fades itself in over the
 * transition window, so the outgoing and incoming scenes overlap visually
 * without <Series> needing to overlap them in time. Keeping the timeline
 * non-overlapping is what lets the SRT timings be read straight off SCENES.
 */
export const sceneStartFrame = (id: SceneId) => {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scene: ${id}`);
  return Math.round(s.from * FPS);
};
