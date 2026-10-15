/**
 * Brand tokens, lifted verbatim from the app so the video can never drift from
 * the product. Sources: src/index.css (CSS custom properties) and
 * tailwind.config.js (font stacks) in the Roamly repo.
 */

export const COLORS = {
  /** hsl(34 38% 92%) — the app's paper background */
  paper: "#F0E9E0",
  /** hsl(25 30% 22%) — foreground ink */
  ink: "#4A3A2E",
  /** Ink at reduced weight, for subcaptions and legal-safe lines */
  inkMuted: "#7A6857",
  /** hsl(24 33% 40%) — primary */
  primary: "#88613F",
  /** hsl(24 30% 51%) */
  purple: "#A87B5C",
  /** hsl(18 45% 55%) */
  coral: "#C47A5B",
  /** hsl(157 16% 55%) */
  blue: "#7DA396",
  /** hsl(157 22% 45%) */
  green: "#5C8C7C",
  /** Dark theme chrome */
  dark: "#16181D",
  white: "#FFFFFF",
} as const;

/** The two signature gradients from src/index.css. */
export const GRADIENTS = {
  primary: `linear-gradient(135deg, ${COLORS.purple}, ${COLORS.blue})`,
  accent: `linear-gradient(135deg, ${COLORS.coral}, ${COLORS.purple})`,
} as const;

/**
 * The single permitted shadow. The brief caps shadow harshness, and having one
 * constant makes that mechanically true rather than a thing to remember.
 */
export const SHADOW = "0 8px 24px rgba(74, 58, 46, 0.12)";

/** Corner radius for the browser/device frames that hold captures. */
export const FRAME_RADIUS = 12;
