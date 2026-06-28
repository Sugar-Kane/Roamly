// The 10 Pomodoro methods. Each defines focus/break/long-break minutes and cadence.
export type Method = {
  id: string;
  name: string;
  blurb: string;
  focus: number;
  short: number;
  long: number;
  cycles: number; // focus blocks before a long break
  premium?: boolean;
};

export const METHODS: Method[] = [
  { id: "classic", name: "Classic 25/5", blurb: "The original. 25 on, 5 off.", focus: 25, short: 5, long: 15, cycles: 4 },
  { id: "deep", name: "Deep Work 50/10", blurb: "Longer blocks for dense material like pharmacology.", focus: 50, short: 10, long: 20, cycles: 3 },
  { id: "rotation", name: "Clinical 90/20", blurb: "Ultradian rhythm. Mirrors a focused rotation block.", focus: 90, short: 20, long: 30, cycles: 2 },
  { id: "sprint", name: "Sprint 15/3", blurb: "Short bursts for flashcards and quick review.", focus: 15, short: 3, long: 10, cycles: 5 },
  { id: "anatomy", name: "Anatomy 45/15", blurb: "Balanced blocks for systems and structures.", focus: 45, short: 15, long: 25, cycles: 3 },
  { id: "pance", name: "PANCE Drill 60/10", blurb: "Exam-pace endurance blocks.", focus: 60, short: 10, long: 25, cycles: 3, premium: true },
  { id: "gentle", name: "Gentle 20/10", blurb: "Lower-intensity days. More recovery.", focus: 20, short: 10, long: 20, cycles: 4 },
  { id: "fifty2", name: "52/17", blurb: "The productivity-study ratio.", focus: 52, short: 17, long: 25, cycles: 3 },
  { id: "marathon", name: "Marathon 120/30", blurb: "For long library sits before an exam.", focus: 120, short: 30, long: 45, cycles: 2, premium: true },
  { id: "custom", name: "Custom", blurb: "Set your own focus, break, and cadence.", focus: 30, short: 7, long: 20, cycles: 4, premium: true },
];

export type Task = { id: string; title: string; tag: string; done: boolean; poms: number; est: number };

export const SEED_TASKS: Task[] = [
  { id: "t1", title: "Cardiology — review heart failure pathways", tag: "Cardio", done: false, poms: 2, est: 4 },
  { id: "t2", title: "Pharm flashcards: beta-blockers", tag: "Pharm", done: false, poms: 1, est: 2 },
  { id: "t3", title: "OSCE practice — abdominal exam", tag: "Clinical", done: true, poms: 3, est: 3 },
  { id: "t4", title: "PANCE practice block (50 questions)", tag: "PANCE", done: false, poms: 0, est: 3 },
];

// Mock weekly focus minutes for the analytics dashboard.
export const WEEK_DATA = [
  { day: "Mon", min: 120, sessions: 4 },
  { day: "Tue", min: 95, sessions: 3 },
  { day: "Wed", min: 180, sessions: 6 },
  { day: "Thu", min: 60, sessions: 2 },
  { day: "Fri", min: 140, sessions: 5 },
  { day: "Sat", min: 210, sessions: 7 },
  { day: "Sun", min: 75, sessions: 3 },
];

export const SUBJECT_SPLIT = [
  { name: "Pharm", value: 32, color: "#7C5CFA" },
  { name: "Cardio", value: 24, color: "#3B82F6" },
  { name: "Clinical", value: 21, color: "#E8765A" },
  { name: "PANCE", value: 23, color: "#16A34A" },
];

// Each theme recolors the whole app. Values are HSL triplets matching the CSS
// variables in index.css (e.g. "250 84% 60%"). `grad` is the timer-card gradient.
// `ring` is the focus-phase timer-ring color; `rest` the break-phase color (hex).
export type Theme = {
  id: string;
  name: string;
  hint: string;
  premium: boolean;
  dark?: boolean;
  ring: string;
  rest: string;
  grad: [string, string];
  vars: Record<string, string>;
};

export const THEMES: Theme[] = [
  {
    id: "coffee",
    name: "Coffee Shop",
    hint: "Warm and cozy",
    premium: false,
    ring: "#A87C5A",
    rest: "#7A9B8E",
    grad: ["#EBDFD0", "#D8C4AE"],
    vars: {
      "--background": "34 38% 92%",
      "--foreground": "25 30% 22%",
      "--card": "36 44% 97%",
      "--card-foreground": "25 30% 22%",
      "--popover": "36 44% 97%",
      "--popover-foreground": "25 30% 22%",
      "--primary": "24 30% 51%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "33 30% 88%",
      "--secondary-foreground": "25 20% 38%",
      "--muted": "33 30% 88%",
      "--muted-foreground": "27 18% 48%",
      "--accent": "157 16% 55%",
      "--accent-foreground": "0 0% 100%",
      "--border": "32 24% 82%",
      "--input": "32 24% 82%",
      "--ring": "24 30% 51%",
      "--roamly-purple": "24 30% 51%",
      "--roamly-coral": "18 45% 55%",
      "--roamly-blue": "157 16% 55%",
      "--roamly-green": "157 22% 45%",
    },
  },
  {
    id: "whitecoat",
    name: "White Coat",
    hint: "Clean and clinical",
    premium: false,
    ring: "#2563EB",
    rest: "#0EA5E9",
    grad: ["#FFFFFF", "#EEF2F7"],
    vars: {
      "--background": "0 0% 100%",
      "--foreground": "222 38% 20%",
      "--card": "210 33% 99%",
      "--card-foreground": "222 38% 20%",
      "--popover": "210 33% 99%",
      "--popover-foreground": "222 38% 20%",
      "--primary": "221 83% 53%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "210 33% 96%",
      "--secondary-foreground": "215 25% 35%",
      "--muted": "210 33% 96%",
      "--muted-foreground": "215 16% 47%",
      "--accent": "199 89% 48%",
      "--accent-foreground": "0 0% 100%",
      "--border": "214 25% 90%",
      "--input": "214 25% 90%",
      "--ring": "221 83% 53%",
      "--roamly-purple": "221 83% 53%",
      "--roamly-coral": "199 89% 48%",
      "--roamly-blue": "199 89% 48%",
      "--roamly-green": "160 70% 40%",
    },
  },
  {
    id: "library",
    name: "Library Night",
    hint: "Dark and focused",
    premium: false,
    dark: true,
    ring: "#A78BFA",
    rest: "#34D399",
    grad: ["#1E2230", "#14161F"],
    vars: {
      "--background": "227 22% 10%",
      "--foreground": "252 30% 92%",
      "--card": "228 21% 15%",
      "--card-foreground": "252 30% 92%",
      "--popover": "228 21% 15%",
      "--popover-foreground": "252 30% 92%",
      "--primary": "255 92% 76%",
      "--primary-foreground": "227 22% 10%",
      "--secondary": "228 18% 20%",
      "--secondary-foreground": "252 20% 88%",
      "--muted": "228 18% 20%",
      "--muted-foreground": "230 12% 66%",
      "--accent": "158 64% 52%",
      "--accent-foreground": "227 22% 10%",
      "--border": "228 16% 24%",
      "--input": "228 16% 24%",
      "--ring": "255 92% 76%",
      "--roamly-purple": "255 92% 76%",
      "--roamly-coral": "12 76% 61%",
      "--roamly-blue": "199 89% 60%",
      "--roamly-green": "158 64% 52%",
    },
  },
  {
    id: "sage",
    name: "Sage Calm",
    hint: "Fresh and relaxed",
    premium: false,
    ring: "#4F9D78",
    rest: "#E0A458",
    grad: ["#EAF1ED", "#D8E6DE"],
    vars: {
      "--background": "150 18% 94%",
      "--foreground": "152 30% 18%",
      "--card": "150 24% 98%",
      "--card-foreground": "152 30% 18%",
      "--popover": "150 24% 98%",
      "--popover-foreground": "152 30% 18%",
      "--primary": "152 33% 46%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "150 18% 89%",
      "--secondary-foreground": "152 22% 32%",
      "--muted": "150 18% 89%",
      "--muted-foreground": "150 14% 42%",
      "--accent": "33 70% 61%",
      "--accent-foreground": "0 0% 100%",
      "--border": "150 16% 83%",
      "--input": "150 16% 83%",
      "--ring": "152 33% 46%",
      "--roamly-purple": "152 33% 46%",
      "--roamly-coral": "33 70% 61%",
      "--roamly-blue": "152 33% 46%",
      "--roamly-green": "152 40% 40%",
    },
  },
];

export type Room = { id: string; name: string; host: string; focus: string; members: number; cap: number };
export const ROOMS: Room[] = [
  { id: "r1", name: "PANCE Grind — Quiet", host: "Maya R.", focus: "PANCE review", members: 7, cap: 12 },
  { id: "r2", name: "Pharm Power Hour", host: "Devin K.", focus: "Pharmacology", members: 4, cap: 8 },
  { id: "r3", name: "Anatomy All-Nighter", host: "Sofia L.", focus: "Musculoskeletal", members: 11, cap: 12 },
  { id: "r4", name: "Early Birds 6AM", host: "Theo M.", focus: "Open study", members: 2, cap: 10 },
];
