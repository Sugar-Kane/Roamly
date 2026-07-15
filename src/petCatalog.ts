// Catalog + presentation metadata for the gamification layer.
//
// Two roles:
//  1. The CATALOG constants mirror the seed rows in the release_11 migration
//     (as expanded by the release_14 catalog-expansion migration). Signed-in
//     users get catalog data straight from get_my_gamification(); these
//     constants are the source of truth for GUEST (signed-out) mode, so keep
//     them in sync with supabase/migrations/..._release_11_gamification.sql
//     and ..._release_14_catalog_expansion.sql.
//  2. PET_ART / PLANT_ART hold the drawing palette for the canvas engine. These
//     are pet/plant-specific colors (a brown dog is brown in every theme), so
//     they're concrete values rather than theme tokens.

export type PetSpecies =
  | "dog" | "cat" | "bird" | "rabbit" | "hamster" | "fox" | "penguin" | "owl" | "turtle"
  | "duck" | "frog" | "raccoon" | "hedgehog" | "koala" | "sloth" | "panda" | "dragon" | "unicorn";

export type PetDef = { id: string; species: PetSpecies; name: string; unlock_sessions: number; sort: number };
export type RewardKind = "plant" | "tree" | "accessory" | "theme";
// Every accessory is functional on the pet stage, keyed by its slot (one
// active per slot): bed = pets nap on it during focus, toy = pets kick it
// around, bowl = pets wander over for snacks, hat/face = worn by the pets.
export type AccessorySlot = "bed" | "hat" | "face" | "toy" | "bowl";
export type RewardDef = { id: string; kind: RewardKind; name: string; unlock_level: number; meta: { emoji?: string; slot?: AccessorySlot }; sort: number };
export type AchievementDef = { id: string; name: string; hint: string; xp: number; sort: number };

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
  { id: "first_focus", name: "First focus", hint: "Finish one focus session", xp: 20, sort: 1 },
  { id: "streak_3", name: "3-day streak", hint: "Study 3 days in a row", xp: 30, sort: 2 },
  { id: "streak_7", name: "7-day streak", hint: "Study 7 days in a row", xp: 60, sort: 3 },
  { id: "century_day", name: "Century day", hint: "100 focus minutes in a day", xp: 40, sort: 4 },
  { id: "deep_day", name: "Deep day", hint: "3 hours of focus in one day", xp: 80, sort: 5 },
  { id: "total_10h", name: "10 hours in", hint: "10 hours of total focus", xp: 50, sort: 6 },
  { id: "total_25h", name: "25 hours in", hint: "25 hours of total focus", xp: 100, sort: 7 },
  { id: "task_finisher", name: "Task finisher", hint: "Complete 10 tasks", xp: 50, sort: 8 },
  { id: "total_50h", name: "50 hours in", hint: "50 hours of total focus", xp: 150, sort: 9 },
  { id: "sessions_50", name: "Half-century", hint: "Complete 50 focus sessions", xp: 80, sort: 10 },
  { id: "social_studier", name: "Study buddy", hint: "Finish a session in a group room", xp: 40, sort: 11 },
  { id: "streak_30", name: "Monthly master", hint: "Study 30 days in a row", xp: 300, sort: 12 },
  { id: "streak_14", name: "Fortnight of focus", hint: "Study 14 days in a row", xp: 120, sort: 13 },
  { id: "task_50", name: "Task master", hint: "Complete 50 tasks", xp: 120, sort: 14 },
  { id: "ultra_day", name: "Ultra day", hint: "5 hours of focus in one day", xp: 150, sort: 15 },
  { id: "squad_scholar", name: "Squad scholar", hint: "Finish 10 sessions in group rooms", xp: 100, sort: 16 },
  { id: "total_100h", name: "Triple digits", hint: "100 hours of total focus", xp: 250, sort: 17 },
  { id: "sessions_100", name: "Session centurion", hint: "Complete 100 focus sessions", xp: 150, sort: 18 },
  { id: "task_100", name: "Checklist champion", hint: "Complete 100 tasks", xp: 200, sort: 19 },
  { id: "total_250h", name: "Scholar in residence", hint: "250 hours of total focus", xp: 500, sort: 20 },
  { id: "sessions_500", name: "Marathon mind", hint: "Complete 500 focus sessions", xp: 500, sort: 21 },
  { id: "streak_100", name: "Centurion", hint: "Study 100 days in a row", xp: 1000, sort: 22 },
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
  if (m.totalMinutes > 0) earned.add("first_focus");
  if (m.streak >= 3) earned.add("streak_3");
  if (m.streak >= 7) earned.add("streak_7");
  if (m.bestDayMinutes >= 100) earned.add("century_day");
  if (m.bestDayMinutes >= 180) earned.add("deep_day");
  if (m.totalMinutes >= 600) earned.add("total_10h");
  if (m.totalMinutes >= 1500) earned.add("total_25h");
  if (m.doneTasks >= 10) earned.add("task_finisher");
  if (m.totalMinutes >= 3000) earned.add("total_50h");
  if (m.sessionCount >= 50) earned.add("sessions_50");
  if (m.hasRoomSession) earned.add("social_studier");
  if (m.streak >= 30) earned.add("streak_30");
  if (m.streak >= 14) earned.add("streak_14");
  if (m.doneTasks >= 50) earned.add("task_50");
  if (m.bestDayMinutes >= 300) earned.add("ultra_day");
  if (m.roomSessionCount >= 10) earned.add("squad_scholar");
  if (m.totalMinutes >= 6000) earned.add("total_100h");
  if (m.sessionCount >= 100) earned.add("sessions_100");
  if (m.doneTasks >= 100) earned.add("task_100");
  if (m.totalMinutes >= 15000) earned.add("total_250h");
  if (m.sessionCount >= 500) earned.add("sessions_500");
  if (m.streak >= 100) earned.add("streak_100");
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

// A plant/tree renders through GROWTH_STAGES many stages; growth_points is
// cumulative completed sessions, so a plant matures as the user studies.
export const GROWTH_STAGES = 5;
export const SESSIONS_PER_GROWTH_STAGE = 6;
export function growthStage(growthPoints: number): number {
  return Math.min(GROWTH_STAGES - 1, Math.floor(Math.max(0, growthPoints) / SESSIONS_PER_GROWTH_STAGE));
}
