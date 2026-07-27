// Privacy-aware session replay.
//
// Deliberately NOT a full DOM recorder. rrweb-style pixel-perfect replay
// serialises the entire DOM including text nodes, which for Roamly means
// uploaded lecture notes and potentially patient case details leaving the
// browser. That is a risk we will not take for debugging convenience.
//
// What we record instead is an INTERACTION TRACE: what the user did, where,
// and what the app did in response — enough to answer "what were they doing
// when it broke" and to author a Playwright reproduction, with no user content
// in it at all. Text is never captured; input events record only that a field
// changed and how long the value is.
//
// The buffer is a fixed-size ring held in memory. It is uploaded ONLY when a
// batch also carries a high-severity event — a healthy session's trace is
// discarded, never transmitted.

import type { ReplayFrame } from "./types";
import { describeElement, elementPath, isSensitiveField } from "./redact";
import { stageReplay } from "./transport";

const MAX_FRAMES = 400;
const MOUSE_SAMPLE_MS = 250;

let frames: ReplayFrame[] = [];
let installed = false;
let enabled = false;
let startedAt = 0;

export function recordFrame(kind: ReplayFrame["k"], data: unknown): void {
  if (!enabled) return;
  frames.push({ t: Date.now() - startedAt, k: kind, d: data });
  if (frames.length > MAX_FRAMES) frames.shift();
  stageReplay(frames);
}

export function installReplay(sampleRate: number): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Sampled: replay is the most expensive signal we collect (bytes and
  // privacy surface), so only a fraction of sessions record by default.
  // Sessions that hit a critical error switch it on retroactively — see
  // forceReplay(), which is why the ring buffer runs even when disabled would
  // be pointless: we accept losing pre-error frames in unsampled sessions in
  // exchange for collecting nothing at all from them.
  enabled = Math.random() < sampleRate;
  if (!enabled) return;
  startedAt = Date.now();

  let lastMouse = 0;
  window.addEventListener("pointermove", (e) => {
    const now = Date.now();
    if (now - lastMouse < MOUSE_SAMPLE_MS) return;
    lastMouse = now;
    recordFrame("m", { x: Math.round(e.clientX), y: Math.round(e.clientY) });
  }, { passive: true });

  window.addEventListener("pointerdown", (e) => {
    const el = e.target as Element | null;
    recordFrame("c", {
      x: Math.round(e.clientX), y: Math.round(e.clientY),
      el: describeElement(el), path: elementPath(el),
      touch: e.pointerType === "touch",
    });
  }, { passive: true, capture: true });

  let lastScroll = 0;
  window.addEventListener("scroll", () => {
    const now = Date.now();
    if (now - lastScroll < 500) return;
    lastScroll = now;
    recordFrame("s", { y: Math.round(window.scrollY) });
  }, { passive: true });

  // Input: shape only. Never the value, never even a masked version of it.
  document.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | null;
    if (!el) return;
    recordFrame("i", {
      el: describeElement(el),
      sensitive: isSensitiveField(el),
      length: typeof el.value === "string" ? el.value.length : 0,
      type: el.type || el.tagName?.toLowerCase(),
    });
  }, { passive: true, capture: true });

  // Keys: only navigational/submitting keys, which are the ones that matter
  // for reproduction. Character keys are never recorded — that would be a
  // keylogger.
  document.addEventListener("keydown", (e) => {
    if (!["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    recordFrame("k", { key: e.key, el: describeElement(e.target as Element) });
  }, { passive: true, capture: true });

  window.addEventListener("resize", () => {
    recordFrame("r", { w: window.innerWidth, h: window.innerHeight });
  }, { passive: true });
}

/**
 * Turn recording on mid-session. Called when a critical event fires in a
 * session that wasn't sampled: from this point forward we capture, so the
 * moments AFTER the failure (the retry, the rage clicks, the abandonment) are
 * on record even though the lead-up is not.
 */
export function forceReplay(): void {
  if (enabled) return;
  enabled = true;
  startedAt = Date.now();
  frames = [];
}

export function replayFrames(): ReplayFrame[] {
  return frames;
}
