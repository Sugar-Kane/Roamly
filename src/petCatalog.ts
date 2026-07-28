// Catalog + presentation metadata for the gamification layer.
//
// Two roles:
//  1. The CATALOG constants mirror the seed rows in the release_11 migration
//     (as expanded by the release_14 catalog-expansion migration). Signed-in
//     users get catalog data straight from get_my_gamification(); these
//     constants are the source of truth for GUEST (signed-out) mode, so keep
//     them in sync with supabase/migrations/..._release_11_gamification.sql
//     ..._release_14_catalog_expansion.sql and
//     ..._release_17_catalog_expansion_2.sql.
//  2. PET_ART / PLANT_ART hold the drawing palette for the canvas engine. These
//     are pet/plant-specific colors (a brown dog is brown in every theme), so
//     they're concrete values rather than theme tokens.

export type PetSpecies =
  | "dog" | "cat" | "bird" | "rabbit" | "hamster" | "fox" | "penguin" | "owl" | "turtle"
  | "duck" | "frog" | "raccoon" | "hedgehog" | "koala" | "sloth" | "panda" | "dragon" | "unicorn";

// Species that treat the toy ball as a toy: they kick it when they bump into
// it, and chase a thrown one across the stage. Everyone else ignores it — a
// sloth or a turtle sitting out the game is the joke, not a bug.
export const BALL_PLAYERS: ReadonlySet<PetSpecies> = new Set<PetSpecies>([
  "dog", "cat", "fox", "raccoon", "penguin", "rabbit", "dragon", "unicorn",
]);

// How many companions share the pen at once. More than a pair turns the stage
// into a scrum at the widths it actually renders at (a ~64px strip on the focus
// page). This is a hard cap: at the limit the Garden page disables the other
// pets' buttons, so swapping means turning one off first.
export const MAX_ACTIVE_PETS = 2;

export type PetDef = { id: string; species: PetSpecies; name: string; unlock_sessions: number; sort: number };
export type RewardKind = "plant" | "tree" | "accessory" | "theme";
// Every accessory is functional on the pet stage, keyed by its slot (one
// active per slot): bed = pets nap on it during focus, toy = pets kick it
// around, bowl = pets wander over for snacks, hat/face = worn by the pets.
export type AccessorySlot = "bed" | "hat" | "face" | "toy" | "bowl";
export type RewardDef = { id: string; kind: RewardKind; name: string; unlock_level: number; meta: { emoji?: string; slot?: AccessorySlot }; sort: number };
// Achievements group into themes on the Garden page so a long list reads as a
// few short ones. The category is presentation only — it is derived here rather
// than stored, so it needs no migration and signed-in rows (which come from
// get_my_gamification without a category column) group identically.
export type AchievementCategory = "focus" | "sessions" | "consistency" | "tasks" | "social";
export type AchievementDef = { id: string; name: string; hint: string; xp: number; sort: number; category: AchievementCategory };

export const ACHIEVEMENT_CATEGORY_LABEL: Record<AchievementCategory, string> = {
  focus: "Focus time",
  sessions: "Session milestones",
  consistency: "Streaks & consistency",
  tasks: "Tasks",
  social: "Group study",
};

// Render order for the grouped sections.
export const ACHIEVEMENT_CATEGORY_ORDER: AchievementCategory[] = ["focus", "sessions", "consistency", "tasks", "social"];

export const PET_CATALOG: PetDef[] = [
  { id: "dog", species: "dog", name: "Pip the Pup", unlock_sessions: 0, sort: 1 },
  { id: "cat", species: "cat", name: "Mochi the Cat", unlock_sessions: 0, sort: 2 },
  { id: "bird", species: "bird", name: "Sunny the Finch", unlock_sessions: 5, sort: 3 },
  { id: "rabbit", species: "rabbit", name: "Clover the Bunny", unlock_sessions: 15, sort: 4 },
  { id: "hamster", species: "hamster", name: "Biscuit", unlock_sessions: 30, sort: 5 },
  { id: "duck", species: "duck", name: "Puddles the Duck", unlock_sessions: 40, sort: 6 },
  { id: "fox", species: "fox", name: "Ember the Fox", unlock_sessions: 60, sort: 7 },
  { id: "frog", species: "frog", name: "Lilypad Louie", unlock_sessions: 80, sort: 8 },
  { id: "penguin", species: "penguin", name: "Waddles", unlock_sessions: 100, sort: 9 },
  { id: "raccoon", species: "raccoon", name: "Bandit", unlock_sessions: 120, sort: 10 },
  { id: "owl", species: "owl", name: "Professor Hoot", unlock_sessions: 150, sort: 11 },
  { id: "hedgehog", species: "hedgehog", name: "Pokey", unlock_sessions: 200, sort: 12 },
  { id: "turtle", species: "turtle", name: "Sage the Turtle", unlock_sessions: 250, sort: 13 },
  { id: "koala", species: "koala", name: "Eucalyptus Eddie", unlock_sessions: 350, sort: 14 },
  { id: "sloth", species: "sloth", name: "Slowmo the Sloth", unlock_sessions: 450, sort: 15 },
  { id: "panda", species: "panda", name: "Bamboo", unlock_sessions: 600, sort: 16 },
  { id: "dragon", species: "dragon", name: "Cinder the Dragon", unlock_sessions: 800, sort: 17 },
  { id: "unicorn", species: "unicorn", name: "Stardust", unlock_sessions: 1000, sort: 18 },
];

export const REWARD_CATALOG: RewardDef[] = [
  { id: "sprout", kind: "plant", name: "Sprout", unlock_level: 1, meta: { emoji: "🌱" }, sort: 1 },
  { id: "succulent", kind: "plant", name: "Succulent", unlock_level: 2, meta: { emoji: "🪴" }, sort: 2 },
  { id: "pet_bed", kind: "accessory", name: "Cozy Pet Bed", unlock_level: 3, meta: { emoji: "🛏️", slot: "bed" }, sort: 3 },
  { id: "fern", kind: "plant", name: "Fern", unlock_level: 4, meta: { emoji: "🌿" }, sort: 4 },
  { id: "bonsai", kind: "tree", name: "Bonsai", unlock_level: 5, meta: { emoji: "🎍" }, sort: 5 },
  { id: "sunflower", kind: "plant", name: "Sunflower", unlock_level: 6, meta: { emoji: "🌻" }, sort: 6 },
  { id: "ball", kind: "accessory", name: "Bouncy Ball", unlock_level: 7, meta: { emoji: "🎾", slot: "toy" }, sort: 7 },
  { id: "maple_sapling", kind: "tree", name: "Maple Sapling", unlock_level: 8, meta: { emoji: "🍁" }, sort: 8 },
  { id: "monstera", kind: "plant", name: "Monstera", unlock_level: 9, meta: { emoji: "🌴" }, sort: 9 },
  { id: "forest_theme", kind: "theme", name: "Forest Theme", unlock_level: 10, meta: { emoji: "🌲" }, sort: 10 },
  { id: "crown", kind: "accessory", name: "Golden Crown", unlock_level: 11, meta: { emoji: "👑", slot: "hat" }, sort: 11 },
  { id: "oak", kind: "tree", name: "Mighty Oak", unlock_level: 12, meta: { emoji: "🌳" }, sort: 12 },
  { id: "snack_bowl", kind: "accessory", name: "Snack Bowl", unlock_level: 13, meta: { emoji: "🥣", slot: "bowl" }, sort: 13 },
  { id: "midnight_theme", kind: "theme", name: "Midnight Theme", unlock_level: 14, meta: { emoji: "🌙" }, sort: 14 },
  { id: "cherry_blossom", kind: "tree", name: "Cherry Blossom", unlock_level: 15, meta: { emoji: "🌸" }, sort: 15 },
  { id: "cactus", kind: "plant", name: "Desert Cactus", unlock_level: 16, meta: { emoji: "🌵" }, sort: 16 },
  { id: "study_cap", kind: "accessory", name: "Study Cap", unlock_level: 17, meta: { emoji: "🧢", slot: "hat" }, sort: 17 },
  { id: "mushroom_grove", kind: "plant", name: "Mushroom Grove", unlock_level: 18, meta: { emoji: "🍄" }, sort: 18 },
  { id: "wishing_bamboo", kind: "tree", name: "Wishing Bamboo", unlock_level: 19, meta: { emoji: "🎋" }, sort: 19 },
  { id: "rainbow_theme", kind: "theme", name: "Rainbow Theme", unlock_level: 20, meta: { emoji: "🌈" }, sort: 20 },
  { id: "cool_shades", kind: "accessory", name: "Cool Shades", unlock_level: 21, meta: { emoji: "🕶️", slot: "face" }, sort: 21 },
  { id: "hibiscus", kind: "plant", name: "Hibiscus", unlock_level: 22, meta: { emoji: "🌺" }, sort: 22 },
  { id: "evergreen", kind: "tree", name: "Evergreen", unlock_level: 24, meta: { emoji: "🎄" }, sort: 23 },
  { id: "lotus", kind: "plant", name: "Lotus", unlock_level: 25, meta: { emoji: "🪷" }, sort: 24 },
  { id: "top_hat", kind: "accessory", name: "Top Hat", unlock_level: 26, meta: { emoji: "🎩", slot: "hat" }, sort: 25 },
  { id: "grape_arbor", kind: "tree", name: "Grape Arbor", unlock_level: 28, meta: { emoji: "🍇" }, sort: 26 },
  { id: "galaxy_theme", kind: "theme", name: "Galaxy Theme", unlock_level: 30, meta: { emoji: "🌌" }, sort: 27 },

  // --- Catalog expansion (release 17) ---
  // Weighted toward accessories, which are the rewards that visibly change the
  // pet stage. Every accessory reuses an existing slot, so the canvas draws
  // them with no new code — a slot's emoji is all it needs.
  { id: "reading_glasses", kind: "accessory", name: "Reading Glasses", unlock_level: 23, meta: { emoji: "👓", slot: "face" }, sort: 28 },
  { id: "yarn_ball", kind: "accessory", name: "Ball of Yarn", unlock_level: 27, meta: { emoji: "🧶", slot: "toy" }, sort: 29 },
  { id: "straw_hat", kind: "accessory", name: "Straw Hat", unlock_level: 29, meta: { emoji: "👒", slot: "hat" }, sort: 30 },
  { id: "lavender", kind: "plant", name: "Lavender", unlock_level: 31, meta: { emoji: "🪻" }, sort: 31 },
  { id: "frisbee", kind: "accessory", name: "Frisbee", unlock_level: 32, meta: { emoji: "🥏", slot: "toy" }, sort: 32 },
  { id: "palm_grove", kind: "tree", name: "Palm Grove", unlock_level: 33, meta: { emoji: "🏝️" }, sort: 33 },
  { id: "milk_bowl", kind: "accessory", name: "Milk Bowl", unlock_level: 34, meta: { emoji: "🥛", slot: "bowl" }, sort: 34 },
  { id: "graduation_cap", kind: "accessory", name: "Graduation Cap", unlock_level: 35, meta: { emoji: "🎓", slot: "hat" }, sort: 35 },
  { id: "goggles", kind: "accessory", name: "Lab Goggles", unlock_level: 36, meta: { emoji: "🥽", slot: "face" }, sort: 36 },
  { id: "teddy", kind: "accessory", name: "Teddy Bear", unlock_level: 37, meta: { emoji: "🧸", slot: "toy" }, sort: 37 },
  { id: "tulip", kind: "plant", name: "Tulip", unlock_level: 38, meta: { emoji: "🌷" }, sort: 38 },
  { id: "cookie_jar", kind: "accessory", name: "Cookie Jar", unlock_level: 39, meta: { emoji: "🍪", slot: "bowl" }, sort: 39 },
  { id: "sunset_theme", kind: "theme", name: "Sunset Theme", unlock_level: 40, meta: { emoji: "🌅" }, sort: 40 },
  { id: "adventure_helmet", kind: "accessory", name: "Adventure Helmet", unlock_level: 41, meta: { emoji: "🪖", slot: "hat" }, sort: 41 },
  { id: "bubbles", kind: "accessory", name: "Bubble Wand", unlock_level: 42, meta: { emoji: "🫧", slot: "toy" }, sort: 42 },
  { id: "orchid", kind: "plant", name: "Orchid", unlock_level: 43, meta: { emoji: "🌼" }, sort: 43 },
  { id: "theatre_mask", kind: "accessory", name: "Theatre Mask", unlock_level: 44, meta: { emoji: "🎭", slot: "face" }, sort: 44 },
  { id: "toy_rocket", kind: "accessory", name: "Toy Rocket", unlock_level: 45, meta: { emoji: "🚀", slot: "toy" }, sort: 45 },
  { id: "cloud_bed", kind: "accessory", name: "Cloud Bed", unlock_level: 46, meta: { emoji: "☁️", slot: "bed" }, sort: 46 },
  { id: "honey_pot", kind: "accessory", name: "Honey Pot", unlock_level: 47, meta: { emoji: "🍯", slot: "bowl" }, sort: 47 },
  { id: "apple_tree", kind: "tree", name: "Apple Tree", unlock_level: 48, meta: { emoji: "🍎" }, sort: 48 },
  { id: "flower_crown", kind: "accessory", name: "Flower Crown", unlock_level: 49, meta: { emoji: "💐", slot: "hat" }, sort: 49 },
  { id: "ocean_theme", kind: "theme", name: "Ocean Theme", unlock_level: 50, meta: { emoji: "🌊" }, sort: 50 },
  { id: "rose", kind: "plant", name: "Rose", unlock_level: 52, meta: { emoji: "🌹" }, sort: 51 },
  { id: "autumn_maple", kind: "tree", name: "Autumn Maple", unlock_level: 54, meta: { emoji: "🍂" }, sort: 52 },
  { id: "treat_jar", kind: "accessory", name: "Treat Jar", unlock_level: 55, meta: { emoji: "🫙", slot: "bowl" }, sort: 53 },
  { id: "party_hat", kind: "accessory", name: "Party Hat", unlock_level: 56, meta: { emoji: "🎉", slot: "hat" }, sort: 54 },
  { id: "desert_theme", kind: "theme", name: "Desert Theme", unlock_level: 58, meta: { emoji: "🏜️" }, sort: 55 },
  { id: "star_plush", kind: "accessory", name: "Star Plush", unlock_level: 60, meta: { emoji: "⭐", slot: "toy" }, sort: 56 },
];

// User-facing blurb for what each accessory slot does on the stage.
export const SLOT_HINT: Record<AccessorySlot, string> = {
  bed: "Pets nap on it during focus",
  toy: "Pets kick it around between sessions",
  bowl: "Pets wander over for a snack",
  hat: "Worn by your pets",
  face: "Worn by your pets",
};

export const ACHIEVEMENT_CATALOG: AchievementDef[] = [
  // --- Focus time: cumulative hours and single-day records ---
  { id: "first_focus", name: "First focus", hint: "Finish one focus session", xp: 20, sort: 1, category: "focus" },
  { id: "half_century_day", name: "Half-century day", hint: "50 focus minutes in a day", xp: 20, sort: 2, category: "focus" },
  { id: "century_day", name: "Century day", hint: "100 focus minutes in a day", xp: 40, sort: 3, category: "focus" },
  { id: "deep_day", name: "Deep day", hint: "3 hours of focus in one day", xp: 80, sort: 4, category: "focus" },
  { id: "ultra_day", name: "Ultra day", hint: "5 hours of focus in one day", xp: 150, sort: 5, category: "focus" },
  { id: "marathon_day", name: "Marathon day", hint: "8 hours of focus in one day", xp: 300, sort: 6, category: "focus" },
  { id: "total_5h", name: "Five hours deep", hint: "5 hours of total focus", xp: 30, sort: 7, category: "focus" },
  { id: "total_10h", name: "10 hours in", hint: "10 hours of total focus", xp: 50, sort: 8, category: "focus" },
  { id: "total_25h", name: "25 hours in", hint: "25 hours of total focus", xp: 100, sort: 9, category: "focus" },
  { id: "total_50h", name: "50 hours in", hint: "50 hours of total focus", xp: 150, sort: 10, category: "focus" },
  { id: "total_100h", name: "Triple digits", hint: "100 hours of total focus", xp: 250, sort: 11, category: "focus" },
  { id: "total_250h", name: "Scholar in residence", hint: "250 hours of total focus", xp: 500, sort: 12, category: "focus" },
  { id: "total_500h", name: "Devoted scholar", hint: "500 hours of total focus", xp: 800, sort: 13, category: "focus" },
  { id: "total_1000h", name: "Thousand-hour club", hint: "1,000 hours of total focus", xp: 1500, sort: 14, category: "focus" },

  // --- Session milestones: how many focus blocks you have finished ---
  { id: "sessions_10", name: "Getting started", hint: "Complete 10 focus sessions", xp: 30, sort: 20, category: "sessions" },
  { id: "sessions_25", name: "Quarter century", hint: "Complete 25 focus sessions", xp: 50, sort: 21, category: "sessions" },
  { id: "sessions_50", name: "Half-century", hint: "Complete 50 focus sessions", xp: 80, sort: 22, category: "sessions" },
  { id: "sessions_100", name: "Session centurion", hint: "Complete 100 focus sessions", xp: 150, sort: 23, category: "sessions" },
  { id: "sessions_250", name: "Session veteran", hint: "Complete 250 focus sessions", xp: 300, sort: 24, category: "sessions" },
  { id: "sessions_500", name: "Marathon mind", hint: "Complete 500 focus sessions", xp: 500, sort: 25, category: "sessions" },
  { id: "sessions_1000", name: "Thousand sessions", hint: "Complete 1,000 focus sessions", xp: 1000, sort: 26, category: "sessions" },

  // --- Streaks & consistency: consecutive days studied ---
  { id: "streak_3", name: "3-day streak", hint: "Study 3 days in a row", xp: 30, sort: 30, category: "consistency" },
  { id: "streak_7", name: "7-day streak", hint: "Study 7 days in a row", xp: 60, sort: 31, category: "consistency" },
  { id: "streak_14", name: "Fortnight of focus", hint: "Study 14 days in a row", xp: 120, sort: 32, category: "consistency" },
  { id: "streak_21", name: "Habit formed", hint: "Study 21 days in a row", xp: 200, sort: 33, category: "consistency" },
  { id: "streak_30", name: "Monthly master", hint: "Study 30 days in a row", xp: 300, sort: 34, category: "consistency" },
  { id: "streak_60", name: "Two-month streak", hint: "Study 60 days in a row", xp: 500, sort: 35, category: "consistency" },
  { id: "streak_100", name: "Centurion", hint: "Study 100 days in a row", xp: 1000, sort: 36, category: "consistency" },
  { id: "streak_180", name: "Half-year habit", hint: "Study 180 days in a row", xp: 1500, sort: 37, category: "consistency" },
  { id: "streak_365", name: "Year of focus", hint: "Study 365 days in a row", xp: 3000, sort: 38, category: "consistency" },

  // --- Tasks: checklist items completed ---
  { id: "task_finisher", name: "Task finisher", hint: "Complete 10 tasks", xp: 50, sort: 40, category: "tasks" },
  { id: "task_25", name: "Getting things done", hint: "Complete 25 tasks", xp: 80, sort: 41, category: "tasks" },
  { id: "task_50", name: "Task master", hint: "Complete 50 tasks", xp: 120, sort: 42, category: "tasks" },
  { id: "task_100", name: "Checklist champion", hint: "Complete 100 tasks", xp: 200, sort: 43, category: "tasks" },
  { id: "task_250", name: "Task titan", hint: "Complete 250 tasks", xp: 350, sort: 44, category: "tasks" },
  { id: "task_500", name: "Completionist", hint: "Complete 500 tasks", xp: 600, sort: 45, category: "tasks" },

  // --- Group study: sessions finished in shared rooms ---
  { id: "social_studier", name: "Study buddy", hint: "Finish a session in a group room", xp: 40, sort: 50, category: "social" },
  { id: "squad_scholar", name: "Squad scholar", hint: "Finish 10 sessions in group rooms", xp: 100, sort: 51, category: "social" },
  { id: "squad_25", name: "Study circle", hint: "Finish 25 sessions in group rooms", xp: 200, sort: 52, category: "social" },
  { id: "squad_50", name: "Room regular", hint: "Finish 50 sessions in group rooms", xp: 350, sort: 53, category: "social" },
  { id: "squad_100", name: "Community pillar", hint: "Finish 100 sessions in group rooms", xp: 600, sort: 54, category: "social" },
];

// Metrics used to decide which achievements are earned (mirrors the SQL in
// sync_my_gamification so guest and signed-in modes agree).
export type StudyMetrics = {
  totalMinutes: number;
  bestDayMinutes: number;
  streak: number;
  sessionCount: number;
  doneTasks: number;
  hasRoomSession: boolean;
  roomSessionCount: number;
};

export function earnedAchievementIds(m: StudyMetrics): Set<string> {
  const earned = new Set<string>();
  // Focus time — cumulative minutes and single-day records.
  if (m.totalMinutes > 0) earned.add("first_focus");
  if (m.bestDayMinutes >= 50) earned.add("half_century_day");
  if (m.bestDayMinutes >= 100) earned.add("century_day");
  if (m.bestDayMinutes >= 180) earned.add("deep_day");
  if (m.bestDayMinutes >= 300) earned.add("ultra_day");
  if (m.bestDayMinutes >= 480) earned.add("marathon_day");
  if (m.totalMinutes >= 300) earned.add("total_5h");
  if (m.totalMinutes >= 600) earned.add("total_10h");
  if (m.totalMinutes >= 1500) earned.add("total_25h");
  if (m.totalMinutes >= 3000) earned.add("total_50h");
  if (m.totalMinutes >= 6000) earned.add("total_100h");
  if (m.totalMinutes >= 15000) earned.add("total_250h");
  if (m.totalMinutes >= 30000) earned.add("total_500h");
  if (m.totalMinutes >= 60000) earned.add("total_1000h");
  // Session milestones.
  if (m.sessionCount >= 10) earned.add("sessions_10");
  if (m.sessionCount >= 25) earned.add("sessions_25");
  if (m.sessionCount >= 50) earned.add("sessions_50");
  if (m.sessionCount >= 100) earned.add("sessions_100");
  if (m.sessionCount >= 250) earned.add("sessions_250");
  if (m.sessionCount >= 500) earned.add("sessions_500");
  if (m.sessionCount >= 1000) earned.add("sessions_1000");
  // Streaks & consistency.
  if (m.streak >= 3) earned.add("streak_3");
  if (m.streak >= 7) earned.add("streak_7");
  if (m.streak >= 14) earned.add("streak_14");
  if (m.streak >= 21) earned.add("streak_21");
  if (m.streak >= 30) earned.add("streak_30");
  if (m.streak >= 60) earned.add("streak_60");
  if (m.streak >= 100) earned.add("streak_100");
  if (m.streak >= 180) earned.add("streak_180");
  if (m.streak >= 365) earned.add("streak_365");
  // Tasks.
  if (m.doneTasks >= 10) earned.add("task_finisher");
  if (m.doneTasks >= 25) earned.add("task_25");
  if (m.doneTasks >= 50) earned.add("task_50");
  if (m.doneTasks >= 100) earned.add("task_100");
  if (m.doneTasks >= 250) earned.add("task_250");
  if (m.doneTasks >= 500) earned.add("task_500");
  // Group study.
  if (m.hasRoomSession) earned.add("social_studier");
  if (m.roomSessionCount >= 10) earned.add("squad_scholar");
  if (m.roomSessionCount >= 25) earned.add("squad_25");
  if (m.roomSessionCount >= 50) earned.add("squad_50");
  if (m.roomSessionCount >= 100) earned.add("squad_100");
  return earned;
}

// Canvas drawing palette per species.
export type PetPalette = { body: string; belly: string; ear: string; detail: string };
export const PET_ART: Record<PetSpecies, PetPalette & { emoji: string }> = {
  dog: { body: "#c8925a", belly: "#efd8b8", ear: "#8f6438", detail: "#3b2a1a", emoji: "🐶" },
  cat: { body: "#8d8f96", belly: "#e7e8ec", ear: "#f0a9b8", detail: "#2f3033", emoji: "🐱" },
  bird: { body: "#f2c14e", belly: "#fbe9b0", ear: "#e08a2c", detail: "#2f2a1a", emoji: "🐤" },
  rabbit: { body: "#e6e2df", belly: "#ffffff", ear: "#f2b8c6", detail: "#3b3538", emoji: "🐰" },
  hamster: { body: "#e7b06a", belly: "#fbeccd", ear: "#c98a44", detail: "#3a2b18", emoji: "🐹" },
  fox: { body: "#e06a34", belly: "#f6e6d5", ear: "#8a3a18", detail: "#2b1a12", emoji: "🦊" },
  penguin: { body: "#2c2f38", belly: "#f4f5f7", ear: "#f2a93b", detail: "#12141a", emoji: "🐧" },
  owl: { body: "#8a6c4f", belly: "#dcc7a8", ear: "#5f4632", detail: "#2a1f14", emoji: "🦉" },
  turtle: { body: "#5fa060", belly: "#d7e8c4", ear: "#3f7a44", detail: "#22331f", emoji: "🐢" },
  duck: { body: "#d9b23a", belly: "#f7e9b8", ear: "#e0862c", detail: "#2f2a1a", emoji: "🦆" },
  frog: { body: "#5cb85c", belly: "#d8f0c0", ear: "#3e8e41", detail: "#22331f", emoji: "🐸" },
  raccoon: { body: "#8d8d93", belly: "#d9d9de", ear: "#4a4a50", detail: "#26262b", emoji: "🦝" },
  hedgehog: { body: "#a4713f", belly: "#f0dcc0", ear: "#6e4a26", detail: "#33241a", emoji: "🦔" },
  koala: { body: "#9aa1a8", belly: "#e6e9ec", ear: "#c8ced4", detail: "#33363b", emoji: "🐨" },
  sloth: { body: "#b09a72", belly: "#e8dcc2", ear: "#8a7450", detail: "#3a3020", emoji: "🦥" },
  panda: { body: "#f2f2f2", belly: "#ffffff", ear: "#2b2b2b", detail: "#1d1d1d", emoji: "🐼" },
  dragon: { body: "#4db07a", belly: "#d9f2c8", ear: "#2f7a52", detail: "#1e3a2a", emoji: "🐉" },
  unicorn: { body: "#f0e6f6", belly: "#ffffff", ear: "#e8a9c8", detail: "#7a5fa0", emoji: "🦄" },
};

// Which way each emoji glyph natively points, so the canvas knows when to
// mirror it. Many animal emoji are head-on portraits (🐶 🐱 🦊) with no
// direction at all — mirroring those is a no-op at best, and at worst pops the
// hat/shades to the wrong side — so they're 0 and never flip. The rest are
// side views, and they do NOT all point the same way: 🦆 🐢 🦥 face right while
// 🐧 🦝 🐤 face left. Values verified glyph-by-glyph against the rendered
// Apple/Noto art; a wrong sign here is exactly the "moonwalking pet" bug.
export const PET_GLYPH_FACING: Record<PetSpecies, -1 | 0 | 1> = {
  dog: 0,       // 🐶 head-on
  cat: 0,       // 🐱 head-on
  bird: -1,     // 🐤 chick, beak left
  rabbit: 0,    // 🐰 head-on
  hamster: 0,   // 🐹 head-on
  fox: 0,       // 🦊 head-on
  penguin: -1,  // 🐧 beak left
  owl: 0,       // 🦉 head-on
  turtle: 1,    // 🐢 head right
  duck: 1,      // 🦆 mallard, bill right
  frog: 0,      // 🐸 head-on
  raccoon: -1,  // 🦝 full body, head left
  hedgehog: -1, // 🦔 full body, snout left
  koala: 0,     // 🐨 head-on
  sloth: 1,     // 🦥 hanging, face right
  panda: 0,     // 🐼 head-on
  dragon: -1,   // 🐉 head lower-left
  unicorn: -1,  // 🦄 three-quarter head, muzzle left
};

// Theme rewards are the pen's wallpaper: a backdrop gradient behind the pets
// plus the floor band they walk on. Before this existed, themes were the one
// reward kind with no effect anywhere in the app — owning one did nothing.
export type StageTheme = { skyTop: string; skyBottom: string; floor: string; floorEdge: string; specks?: string };
export const STAGE_THEMES: Record<string, StageTheme> = {
  forest_theme:   { skyTop: "#1f3a2c", skyBottom: "#2f5b41", floor: "#3d6b45", floorEdge: "#2a4b31" },
  midnight_theme: { skyTop: "#0d1326", skyBottom: "#1c2747", floor: "#232f52", floorEdge: "#151d36", specks: "#cdd8ff" },
  galaxy_theme:   { skyTop: "#160f2e", skyBottom: "#3a1f5c", floor: "#2c1a47", floorEdge: "#1c1030", specks: "#e9d8ff" },
  rainbow_theme:  { skyTop: "#ffd9e8", skyBottom: "#dcefff", floor: "#ffe9b8", floorEdge: "#f3cf8d" },
  sunset_theme:   { skyTop: "#3a1f3d", skyBottom: "#e8724c", floor: "#8f4a3c", floorEdge: "#5e2f28" },
  ocean_theme:    { skyTop: "#0b2a45", skyBottom: "#1f6f9c", floor: "#1b5570", floorEdge: "#0f3a4f", specks: "#bfe9ff" },
  desert_theme:   { skyTop: "#f6c98a", skyBottom: "#f7e2b8", floor: "#e0b477", floorEdge: "#b78a52" },
};

// A plant/tree renders through GROWTH_STAGES many stages; growth_points is
// cumulative completed sessions, so a plant matures as the user studies.
export const GROWTH_STAGES = 5;
export const SESSIONS_PER_GROWTH_STAGE = 6;
export function growthStage(growthPoints: number): number {
  return Math.min(GROWTH_STAGES - 1, Math.floor(Math.max(0, growthPoints) / SESSIONS_PER_GROWTH_STAGE));
}

const GROWTH_LABELS = ["Seedling", "Sprouting", "Growing", "Thriving", "Full grown"];
export const growthLabel = (stage: number): string =>
  GROWTH_LABELS[Math.max(0, Math.min(GROWTH_LABELS.length - 1, stage))]!;
