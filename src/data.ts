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
  { id: "custom", name: "Custom", blurb: "Set your own focus, break, and cadence.", focus: 30, short: 7, long: 20, cycles: 4 },
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
  { name: "Pharm", value: 32, color: "#E8A33D" },
  { name: "Cardio", value: 24, color: "#7A9B8E" },
  { name: "Clinical", value: 21, color: "#C76B5A" },
  { name: "PANCE", value: 23, color: "#8A909C" },
];

export type Theme = { id: string; name: string; premium: boolean; from: string; to: string };
export const THEMES: Theme[] = [
  { id: "lamp", name: "Study Lamp", premium: false, from: "#1E2128", to: "#16181D" },
  { id: "dawn", name: "Dawn Library", premium: true, from: "#2A2118", to: "#171311" },
  { id: "forest", name: "Forest Window", premium: true, from: "#16201B", to: "#11160F" },
  { id: "rain", name: "Rain on Glass", premium: true, from: "#181D24", to: "#10141A" },
];

export type Room = { id: string; name: string; host: string; focus: string; members: number; cap: number };
export const ROOMS: Room[] = [
  { id: "r1", name: "PANCE Grind — Quiet", host: "Maya R.", focus: "PANCE review", members: 7, cap: 12 },
  { id: "r2", name: "Pharm Power Hour", host: "Devin K.", focus: "Pharmacology", members: 4, cap: 8 },
  { id: "r3", name: "Anatomy All-Nighter", host: "Sofia L.", focus: "Musculoskeletal", members: 11, cap: 12 },
  { id: "r4", name: "Early Birds 6AM", host: "Theo M.", focus: "Open study", members: 2, cap: 10 },
];
