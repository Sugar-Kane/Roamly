// Human-readable names and categories for analytics events, so the admin
// dashboard never shows raw event names like "count_up_complete" in its main
// interface (the raw name is only exposed in the optional technical detail
// view). Unknown/new events fall back to a title-cased version of the name.

export const EVENT_LABELS: Record<string, string> = {
  view_focus: "Focus tab visits",
  view_tasks: "Tasks tab visits",
  view_rooms: "Rooms tab visits",
  view_garden: "Garden tab visits",
  view_analytics: "Analytics tab visits",
  view_premium: "Premium page visits",
  view_admin: "Admin page visits",
  timer_start: "Timer started",
  focus_block_done: "Focus blocks finished",
  focus_mode_enter: "Focus mode opened",
  count_up_complete: "Count-up saved",
  pip_open: "Pop-out timer opened",
  task_add: "Tasks added",
  task_done: "Tasks completed",
  task_ai_upload: "AI note uploads",
  room_join: "Rooms joined",
  room_host: "Rooms hosted",
  room_focus_mode: "Room focus mode",
  voice_join: "Voice chat joined",
  music_play: "Built-in music played",
  embed_play: "Spotify/Apple used",
  theme_change: "Theme changed",
  tutorial_done: "Tutorial completed",
  feedback_sent: "Feedback sent",
  buy_credits: "Credit pack checkout",
  ad_submitted: "Ad submissions",
};

export type FeatureCategory = "Navigation" | "Focus" | "Tasks" | "Rooms" | "Music" | "Account" | "Monetization";

const CATEGORY: Record<string, FeatureCategory> = {
  view_focus: "Navigation", view_tasks: "Navigation", view_rooms: "Navigation", view_garden: "Navigation",
  view_analytics: "Navigation", view_premium: "Navigation", view_admin: "Navigation",
  timer_start: "Focus", focus_block_done: "Focus", focus_mode_enter: "Focus", count_up_complete: "Focus", pip_open: "Focus",
  task_add: "Tasks", task_done: "Tasks", task_ai_upload: "Tasks",
  room_join: "Rooms", room_host: "Rooms", room_focus_mode: "Rooms", voice_join: "Rooms",
  music_play: "Music", embed_play: "Music",
  theme_change: "Account", tutorial_done: "Account", feedback_sent: "Account",
  buy_credits: "Monetization", ad_submitted: "Monetization",
};

export function featureLabel(name: string): string {
  return EVENT_LABELS[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function featureCategory(name: string): FeatureCategory | "Other" {
  return CATEGORY[name] ?? "Other";
}

export const FEATURE_CATEGORIES: (FeatureCategory | "Other")[] = ["Navigation", "Focus", "Tasks", "Rooms", "Music", "Account", "Monetization", "Other"];
