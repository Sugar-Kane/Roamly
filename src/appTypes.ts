import type { LucideIcon } from "lucide-react";
import type { FocusSoundId } from "./focusSounds";

// Every tab has its own URL (/focus, /tasks, …) so pages are linkable and the
// browser back button works. Unknown paths fall back to Focus; vercel.json
// already rewrites all non-api paths to the SPA.
export type View = "focus" | "tasks" | "analytics" | "rooms" | "garden" | "premium" | "admin";

export const VIEW_LABELS: Record<View, string> = {
  focus: "Focus", tasks: "Tasks", analytics: "Analytics", rooms: "Rooms",
  garden: "Garden", premium: "Premium", admin: "Admin",
};

export function viewFromPath(pathname: string): View {
  const slug = pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  return (Object.keys(VIEW_LABELS) as View[]).find((v) => v === slug) ?? "focus";
}

// A single streaming embed target (Spotify or Apple Music), held at App level
// and rendered in the persistent mini-dock.
export type EmbedTarget = { service: "spotify" | "apple"; src: string; height: number; label: string };

// The editable timing for the "custom" Pomodoro method (minutes + block count),
// held in App state and edited via CustomEditor.
export type CustomMethod = { focus: number; short: number; long: number; cycles: number };

// The built-in focus-sounds controller object assembled in App() and threaded
// down to the sound panels. Mirrors the `sounds` object built in App.
export interface SoundsController {
  sound: FocusSoundId | null;
  auto: boolean;
  volume: number;
  playing: boolean;
  choose: (id: FocusSoundId) => void;
  toggle: () => void;
  setAuto: (next: boolean) => void;
  setVolume: (v: number) => void;
}

// One entry in the bottom navigation bar.
export interface NavItem {
  id: View;
  label: string;
  icon: LucideIcon;
  locked?: boolean;
}
