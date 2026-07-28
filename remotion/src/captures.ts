/**
 * The manifest of screen captures the video depends on.
 *
 * This is the contract between scripts/capture-shots.mjs (which produces the
 * files) and the scenes (which consume them). scripts/preflight.mjs reads this
 * same list and refuses to render if any file is missing or suspiciously
 * small, which is what enforces the brief's rule that no placeholder and no
 * empty state can reach the finished video.
 */

export type CaptureKind = "image" | "video";

export type CaptureSpec = {
  /** Filename inside public/captures/ */
  file: string;
  kind: CaptureKind;
  /** Which storyboard scene consumes it — drives the shot list. */
  scene: string;
  /** What the capture must show, quoted in the contact sheet for sign-off. */
  intent: string;
  /** Expected clip length in seconds, for the .mp4 captures. */
  seconds?: [number, number];
};

export const CAPTURES = {
  focusTimer: {
    file: "01-focus-timer.png",
    kind: "image",
    scene: "2 — The timer",
    intent: "Timer mid focus block with the task list visible alongside it.",
  },
  methods: {
    file: "02-methods.png",
    kind: "image",
    scene: "3 — The methods",
    intent: "Method picker open, showing the PA presets.",
  },
  upload: {
    file: "03-upload.mp4",
    kind: "video",
    scene: "4 — AI from your notes",
    intent: "AI note upload: choose file, processing, generated task list appears.",
    seconds: [8, 12],
  },
  room: {
    file: "04-room.mp4",
    kind: "video",
    scene: "5 — You're not studying alone",
    intent: "Live study room with the shared countdown ticking and participants visible.",
    seconds: [8, 12],
  },
  analytics: {
    file: "05-analytics.png",
    kind: "image",
    scene: "7 — Progress you can see",
    intent: "Analytics view showing real weekly history.",
  },
  garden: {
    file: "06-garden.png",
    kind: "image",
    scene: "7 — Progress you can see",
    intent: "Companions / garden with unlocked pets.",
  },
  pip: {
    file: "07-pip.mp4",
    kind: "video",
    scene: "7 — Progress you can see",
    intent: "Picture-in-picture timer floating over another window.",
    seconds: [4, 6],
  },
  themes: {
    file: "08-themes.mp4",
    kind: "video",
    scene: "Held in reserve (see shot list)",
    intent: "Switching between two or three themes.",
    seconds: [4, 6],
  },
  mobileTimer: {
    file: "09-mobile-timer.png",
    kind: "image",
    scene: "Held in reserve (see shot list)",
    intent: "Timer view at a 390x844 iPhone 14 viewport.",
  },
  mobileRoom: {
    file: "10-mobile-room.png",
    kind: "image",
    scene: "5 — You're not studying alone",
    intent: "Study room at a 390x844 iPhone 14 viewport, same countdown as 04-room.mp4.",
  },
} as const satisfies Record<string, CaptureSpec>;

export type CaptureKey = keyof typeof CAPTURES;

export const CAPTURE_LIST: CaptureSpec[] = Object.values(CAPTURES);

export const capturePath = (key: CaptureKey) => `captures/${CAPTURES[key].file}`;
