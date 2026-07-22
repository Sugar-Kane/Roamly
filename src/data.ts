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

// Free methods first, then premium ones grouped at the end — the Focus page
// renders in this order, so premium options stay together at the bottom.
export const METHODS: Method[] = [
  { id: "classic", name: "Classic 25/5", blurb: "The original. 25 on, 5 off.", focus: 25, short: 5, long: 15, cycles: 4 },
  { id: "deep", name: "Deep Work 50/10", blurb: "Longer blocks for dense material like pharmacology.", focus: 50, short: 10, long: 20, cycles: 3 },
  { id: "rotation", name: "Clinical 90/20", blurb: "Ultradian rhythm. Mirrors a focused rotation block.", focus: 90, short: 20, long: 30, cycles: 2 },
  { id: "sprint", name: "Sprint 15/3", blurb: "Short bursts for flashcards and quick review.", focus: 15, short: 3, long: 10, cycles: 5 },
  { id: "anatomy", name: "Anatomy 45/15", blurb: "Balanced blocks for systems and structures.", focus: 45, short: 15, long: 25, cycles: 3 },
  { id: "gentle", name: "Gentle 20/10", blurb: "Lower-intensity days. More recovery.", focus: 20, short: 10, long: 20, cycles: 4 },
  { id: "fifty2", name: "52/17", blurb: "The productivity-study ratio.", focus: 52, short: 17, long: 25, cycles: 3 },
  { id: "pance", name: "PANCE Drill 60/10", blurb: "Exam-pace endurance blocks.", focus: 60, short: 10, long: 25, cycles: 3, premium: true },
  { id: "marathon", name: "Marathon 120/30", blurb: "For long library sits before an exam.", focus: 120, short: 30, long: 45, cycles: 2, premium: true },
  { id: "custom", name: "Custom", blurb: "Set your own focus, break, and cadence.", focus: 30, short: 7, long: 20, cycles: 4, premium: true },
];

export type Task = { id: string; title: string; tag: string; done: boolean; poms: number; est: number; sort_order?: number | null };

export const SEED_TASKS: Task[] = [
  { id: "t1", title: "Cardiology: review heart failure pathways", tag: "Cardio", done: false, poms: 2, est: 4, sort_order: 1 },
  { id: "t2", title: "Pharm flashcards: beta-blockers", tag: "Pharm", done: false, poms: 1, est: 2, sort_order: 2 },
  { id: "t3", title: "OSCE practice: abdominal exam", tag: "Clinical", done: true, poms: 3, est: 3, sort_order: 3 },
  { id: "t4", title: "PANCE practice block (50 questions)", tag: "PANCE", done: false, poms: 0, est: 3, sort_order: 4 },
];

// User-controlled task order: sort_order ascending, unnumbered tasks last
// (JS sort is stable, so ties keep their fetch order).
export function sortTasks(list: Task[]): Task[] {
  return [...list].sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity));
}

// Stable accent color per subject tag.
// Custom subjects hash into a fixed palette so each one keeps the same color
// everywhere (pills, group headers) across sessions and devices.
const TAG_COLORS: Record<string, string> = {
  Pharm: "#7C5CFA",
  Cardio: "#3B82F6",
  Clinical: "#E8765A",
  PANCE: "#16A34A",
  Anatomy: "#D97706",
};

const TAG_PALETTE = ["#DB2777", "#0D9488", "#9333EA", "#CA8A04", "#0284C7", "#DC2626", "#65A30D", "#7C3AED"];

export function tagColor(tag: string): string {
  if (TAG_COLORS[tag]) return TAG_COLORS[tag];
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

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

// Accessible label color for text/icons placed on a solid theme color (e.g. the
// timer ring behind Start/Pause, which is applied inline as a background). Picks
// white or near-black — whichever has the higher contrast against that exact
// color — so the label stays legible on every theme and on the color-blind
// override, meeting WCAG 1.4.3. Accepts 3- or 6-digit hex.
export function readableTextOn(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const toLin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast vs white = 1.05/(lum+0.05); vs black = (lum+0.05)/0.05.
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.05 ? "#ffffff" : "#15130f";
}

export const THEMES: Theme[] = [
  {
    id: "coffee",
    name: "Coffee Shop",
    hint: "Warm and cozy",
    premium: false,
    ring: "#886044",
    rest: "#7A9B8E",
    grad: ["#EBDFD0", "#D8C4AE"],
    vars: {
      "--background": "34 38% 92%",
      "--foreground": "25 30% 22%",
      "--card": "36 44% 97%",
      "--card-foreground": "25 30% 22%",
      "--popover": "36 44% 97%",
      "--popover-foreground": "25 30% 22%",
      "--primary": "24 33% 40%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "33 30% 88%",
      "--secondary-foreground": "25 20% 38%",
      "--muted": "33 30% 88%",
      "--muted-foreground": "27 20% 40%",
      "--accent": "157 16% 55%",
      "--accent-foreground": "0 0% 100%",
      "--border": "32 24% 82%",
      "--input": "32 24% 82%",
      "--ring": "24 33% 40%",
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
      "--muted-foreground": "215 16% 44%",
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
    ring: "#367859",
    rest: "#E0A458",
    grad: ["#EAF1ED", "#D8E6DE"],
    vars: {
      "--background": "150 18% 94%",
      "--foreground": "152 30% 18%",
      "--card": "150 24% 98%",
      "--card-foreground": "152 30% 18%",
      "--popover": "150 24% 98%",
      "--popover-foreground": "152 30% 18%",
      "--primary": "152 38% 34%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "150 18% 89%",
      "--secondary-foreground": "152 22% 32%",
      "--muted": "150 18% 89%",
      "--muted-foreground": "150 15% 38%",
      "--accent": "33 70% 61%",
      "--accent-foreground": "0 0% 100%",
      "--border": "150 16% 83%",
      "--input": "150 16% 83%",
      "--ring": "152 38% 34%",
      "--roamly-purple": "152 33% 46%",
      "--roamly-coral": "33 70% 61%",
      "--roamly-blue": "152 33% 46%",
      "--roamly-green": "152 40% 40%",
    },
  },
  {
    id: "sunset",
    name: "Sunset Study",
    hint: "Peach, amber, and plum",
    premium: false,
    ring: "#AE4529",
    rest: "#8B5E83",
    grad: ["#F9E1D0", "#EBC4B8"],
    vars: {
      "--background": "22 62% 93%",
      "--foreground": "333 24% 22%",
      "--card": "25 70% 98%",
      "--card-foreground": "333 24% 22%",
      "--popover": "25 70% 98%",
      "--popover-foreground": "333 24% 22%",
      "--primary": "13 62% 42%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "18 42% 87%",
      "--secondary-foreground": "333 18% 34%",
      "--muted": "18 42% 87%",
      "--muted-foreground": "333 14% 42%",
      "--accent": "311 19% 46%",
      "--accent-foreground": "0 0% 100%",
      "--border": "18 30% 80%",
      "--input": "18 30% 80%",
      "--ring": "13 62% 42%",
      "--roamly-purple": "311 19% 46%",
      "--roamly-coral": "13 64% 58%",
      "--roamly-blue": "311 19% 46%",
      "--roamly-green": "146 35% 42%",
    },
  },
  {
    id: "ocean",
    name: "Ocean Desk",
    hint: "Cool blue and sea glass",
    premium: false,
    ring: "#217291",
    rest: "#3AAFA9",
    grad: ["#E3F2F4", "#C9E5E8"],
    vars: {
      "--background": "187 36% 93%",
      "--foreground": "202 42% 19%",
      "--card": "190 45% 98%",
      "--card-foreground": "202 42% 19%",
      "--popover": "190 45% 98%",
      "--popover-foreground": "202 42% 19%",
      "--primary": "197 63% 35%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "187 28% 86%",
      "--secondary-foreground": "202 30% 30%",
      "--muted": "187 28% 86%",
      "--muted-foreground": "202 18% 40%",
      "--accent": "177 49% 46%",
      "--accent-foreground": "0 0% 100%",
      "--border": "187 25% 78%",
      "--input": "187 25% 78%",
      "--ring": "197 63% 35%",
      "--roamly-purple": "197 63% 38%",
      "--roamly-coral": "177 49% 46%",
      "--roamly-blue": "197 63% 38%",
      "--roamly-green": "163 46% 39%",
    },
  },
];

export type Room = { id: string; name: string; host: string; focus: string; members: number; cap: number };
export const ROOMS: Room[] = [
  { id: "r1", name: "PANCE Grind (Quiet)", host: "Maya R.", focus: "PANCE review", members: 7, cap: 12 },
  { id: "r2", name: "Pharm Power Hour", host: "Devin K.", focus: "Pharmacology", members: 4, cap: 8 },
  { id: "r3", name: "Anatomy All-Nighter", host: "Sofia L.", focus: "Musculoskeletal", members: 11, cap: 12 },
  { id: "r4", name: "Early Birds 6AM", host: "Theo M.", focus: "Open study", members: 2, cap: 10 },
];
