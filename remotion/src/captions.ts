/**
 * Every caption that appears on screen, with the scene it belongs to and the
 * seconds it is visible. Scenes import from here rather than hard-coding
 * strings, and scripts/make-srt.mjs writes captions.srt from the same array —
 * so the burned-in open captions and the .srt can never diverge.
 *
 * The brief requires every caption to hold for at least 2 seconds; that is
 * asserted in scripts/make-srt.mjs rather than trusted.
 */

import type { SceneId } from "./timing";

export type Caption = {
  scene: SceneId;
  /** Absolute start second in the finished video. */
  start: number;
  /** Absolute end second. */
  end: number;
  /** Rendered as one line per array entry. */
  lines: string[];
  /** Secondary line in muted ink, e.g. the free-tier qualifier. */
  sub?: string;
};

export const CAPTIONS: Caption[] = [
  // Scene 1 lines are the scene's own typography rather than lower-third
  // captions, but they are still spoken content, so they belong in the SRT.
  { scene: "feeling", start: 0.4, end: 2.4, lines: ["Four exams in three weeks."] },
  { scene: "feeling", start: 1.6, end: 3.6, lines: ["A pharm deck you haven't opened."] },
  { scene: "feeling", start: 2.8, end: 4.8, lines: ["And it's already 9pm."] },
  {
    scene: "feeling",
    start: 4.7,
    end: 7,
    lines: ["You're not behind.", "You just need the next 25 minutes."],
  },

  {
    scene: "timer",
    start: 8.5,
    end: 15.6,
    lines: ["A focus timer built for PA school.", "Free. No account needed."],
  },

  {
    scene: "methods",
    start: 17,
    end: 23.6,
    lines: ["Pick the block that matches the material."],
  },

  {
    scene: "upload",
    start: 25.5,
    end: 33.6,
    lines: ["Drop in a lecture PDF.", "Get a task list you can actually finish."],
    sub: "3 free AI uploads a month.",
  },

  {
    scene: "rooms",
    start: 35.5,
    end: 43.6,
    lines: ["Live study rooms. One shared timer.", "Chat only opens on breaks."],
  },

  {
    scene: "breaks",
    start: 46.5,
    end: 49.6,
    lines: ["Breaks are part of the method, not a failure of it."],
  },

  {
    scene: "progress",
    start: 51,
    end: 55.6,
    lines: ["Streaks, analytics, and a companion that grows with your hours."],
  },

  {
    scene: "close",
    start: 56.8,
    end: 60,
    lines: ["Start your next 25 minutes.", "roamlyflow.com — free, no account needed."],
  },
];

/** The chips that pop in one at a time in Scene 3. */
export const METHOD_CHIPS = [
  { label: "Sprint 15/3", note: "flashcards" },
  { label: "Deep Work 50/10", note: "pharm" },
  { label: "Anatomy 45/15", note: "systems" },
  { label: "Clinical 90/20", note: "rotation pace" },
  { label: "PANCE Drill 60/10", note: "" },
] as const;

/** The break prompts in Scene 6, worded as they are in src/HealthyBreakActivities.tsx. */
export const BREAK_PROMPTS = [
  "Drink water.",
  "Rest your eyes.",
  "Stand up, if your space allows.",
] as const;
