import { useCallback, useEffect, useState } from "react";
import type { Theme } from "./data";
import type { A11ySettings } from "./ProfileMenu";

// Document Picture-in-Picture support for the focus timer: pop the countdown
// out into a small always-on-top OS window so it stays visible while the user
// works in other apps/tabs. Desktop Chromium (Chrome/Edge) only; everywhere
// else PIP_SUPPORTED is false and the UI hides the entry point.
//
// A PiP window is a SEPARATE document that inherits none of the opener's
// styles, so opening one means (1) cloning the app's stylesheet nodes into it
// and (2) copying the active theme's inline CSS variables onto its root —
// mirroring the theme effect in App.tsx. The timer itself is shared by
// rendering the SAME `timer` object into the PiP document via React portal
// (see App.tsx), never a second useTimer instance.

// Minimal shape of the Document PiP API we rely on (not yet in lib.dom.d.ts).
type DocumentPictureInPicture = {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
};
function pipApi(): DocumentPictureInPicture | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture ?? null;
}

export const PIP_SUPPORTED = typeof window !== "undefined" && "documentPictureInPicture" in window;

// Clone every stylesheet from the opener into the PiP document's head. Handles
// dev (Vite injects a <style> tag) and prod (a hashed <link rel=stylesheet>)
// alike; the Google-Fonts @import inside index.css rides along in the <style>/
// <link>. adoptedStyleSheets are copied too, in case a constructed sheet is used.
export function copyStylesToPip(pip: Window): void {
  try {
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      pip.document.head.appendChild(pip.document.importNode(node, true));
    });
    const adopted = (document as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets;
    if (adopted && adopted.length) {
      const pipDoc = pip.document as unknown as { adoptedStyleSheets?: CSSStyleSheet[] };
      const PipCSSStyleSheet = (pip as unknown as { CSSStyleSheet: typeof CSSStyleSheet }).CSSStyleSheet;
      pipDoc.adoptedStyleSheets = adopted.map((sheet) => {
        try {
          const clone = new PipCSSStyleSheet();
          for (const rule of Array.from(sheet.cssRules)) clone.insertRule(rule.cssText, clone.cssRules.length);
          return clone;
        } catch { return sheet; }
      });
    }
  } catch { /* styling is best-effort; the timer still functions unstyled */ }
}

// Apply the active theme + a11y overrides onto the PiP document root — the same
// logic as the App.tsx theme effect, kept in sync by mirroring it here.
export function applyThemeToPip(pip: Window, theme: Theme, a11y: A11ySettings): void {
  try {
    const root = pip.document.documentElement;
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.classList.toggle("dark", !!theme.dark);
    root.style.colorScheme = theme.dark ? "dark" : "light";
    if (a11y.colorBlind) root.style.setProperty("--roamly-green", "41 100% 45%");
    else root.style.removeProperty("--roamly-green");
    if (a11y.highContrast) {
      root.style.setProperty("--muted-foreground", theme.vars["--foreground"]);
      root.style.setProperty("--border", theme.vars["--foreground"]);
    }
    root.classList.toggle("a11y-reduce-motion", a11y.reduceMotion);
    // The pop-out timer renders at 75% scale — all its text/spacing is rem-based,
    // so shrinking the root font-size shrinks the whole thing proportionally.
    // Large-text a11y still wins (scales up from that smaller base).
    root.style.fontSize = a11y.largeText ? "112.5%" : "75%";
    pip.document.body.style.background = "hsl(var(--background))";
  } catch { /* best-effort */ }
}

export function useDocumentPip(theme: Theme, a11y: A11ySettings) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  // Close the child window if the main tab unmounts/navigates away.
  useEffect(() => () => { try { pipWindow?.close(); } catch { /* already gone */ } }, [pipWindow]);

  const openPip = useCallback(async (opts?: { width?: number; height?: number }): Promise<Window | null> => {
    const api = pipApi();
    if (!api || pipWindow) { pipWindow?.focus(); return pipWindow; }
    let pip: Window;
    try {
      // MUST be the first await after the user gesture, or the request is denied.
      pip = await api.requestWindow({ width: opts?.width ?? 180, height: opts?.height ?? 203 });
    } catch {
      return null; // denied / unsupported / already open — no-op
    }
    // Style + theme land before the portal mounts, so there's no unstyled flash.
    copyStylesToPip(pip);
    applyThemeToPip(pip, theme, a11y);
    try { pip.document.title = "Roamly timer"; } catch { /* ignore */ }
    // pagehide is the single "closed" signal — fires for the window's X and for
    // a programmatic close() — so clearing state here unmounts the portal once.
    pip.addEventListener("pagehide", () => setPipWindow(null), { once: true });
    setPipWindow(pip);
    return pip;
  }, [pipWindow, theme, a11y]);

  const closePip = useCallback(() => {
    try { pipWindow?.close(); } catch { /* pagehide will clear state */ }
  }, [pipWindow]);

  return { pipWindow, supported: PIP_SUPPORTED, openPip, closePip };
}
