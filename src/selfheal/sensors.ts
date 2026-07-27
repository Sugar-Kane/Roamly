// Passive detectors. These need no per-feature instrumentation: they watch the
// page and infer frustration and breakage from behaviour.
//
// The detectors here are deliberately conservative. A false positive costs
// engineering attention, which is the scarcest resource this platform spends —
// so each detector has an explicit "why this is definitely a defect" argument
// in its comment, and thresholds tuned to make the common innocent case quiet.

import type { EventKind, Severity } from "./types";
import { enqueueEvent } from "./transport";
import { currentRoute } from "./session";
import { describeElement, elementPath, isSensitiveField, redactText, redactUrl } from "./redact";
import { installNetworkMonitor, onNetwork } from "./net";
import { recordFrame } from "./replay";

let installed = false;

function emit(kind: EventKind, severity: Severity, payload: Record<string, unknown>, component?: string): void {
  enqueueEvent({ kind, severity, route: currentRoute(), component, payload, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// Dead clicks
// ---------------------------------------------------------------------------
// A dead click is a click on something that LOOKS interactive where nothing
// observable happened afterwards: no DOM mutation, no navigation, no network
// request. That combination is very hard to produce innocently — an intact
// button always does at least one of the three. This is the detector that
// finds the "button does nothing" bugs users normally have to report.

const DEAD_CLICK_WINDOW_MS = 1200;

function looksInteractive(el: Element | null): boolean {
  if (!el) return false;
  const node = el.closest("button,a,[role=button],[role=link],[role=tab],[role=menuitem],input[type=submit],[data-sh]");
  if (!node) return false;
  // A disabled control doing nothing is correct behaviour, not a bug.
  if ((node as HTMLButtonElement).disabled) return false;
  if (node.getAttribute("aria-disabled") === "true") return false;
  return true;
}

/**
 * Did this mutation plausibly come from the click, or is it just the app
 * living its life?
 *
 * This distinction is the whole detector. Roamly always has a running timer
 * rewriting text nodes and animation classes, so "any mutation happened" is
 * true 100% of the time and would suppress every real dead click — which is
 * exactly what the first version of this code did.
 *
 * We therefore count only STRUCTURAL changes (nodes added or removed), and
 * only those that are either inside the clicked element's neighbourhood or a
 * newly mounted overlay/dialog/toast. Attribute and text-content churn is
 * ignored entirely.
 */
function isResponsiveMutation(records: MutationRecord[], clicked: Element): boolean {
  // The clicked element's immediate neighbourhood — but only when that is a
  // narrow enough scope to mean anything. An earlier version accepted any
  // ANCESTOR of the clicked element, which is always satisfied by <body>: in a
  // React SPA something re-renders at the root constantly, so every dead click
  // read as responsive. Ancestor containment is not evidence.
  const scope = clicked.parentElement;
  const scopeIsMeaningful =
    scope != null && scope !== document.body && scope !== document.documentElement;

  for (const record of records) {
    if (record.type !== "childList" || record.addedNodes.length + record.removedNodes.length === 0) continue;
    const target = record.target as Element;

    // A change inside the thing that was clicked, or among its siblings.
    if (clicked.contains(target)) return true;
    if (scopeIsMeaningful && scope.contains(target)) return true;

    // A newly mounted overlay: dialog, toast, menu, tooltip — the usual ways a
    // button responds without touching its own subtree.
    for (const node of Array.from(record.addedNodes)) {
      if (!(node instanceof Element)) continue;
      const role = node.getAttribute("role");
      if (role && ["dialog", "alertdialog", "status", "alert", "menu", "listbox", "tooltip"].includes(role)) return true;
      if (node.matches?.("[data-sh],[aria-modal],[data-state=open]")) return true;
      if (node.querySelector?.('[role="dialog"],[role="status"],[role="alert"],[aria-modal]')) return true;
    }
  }
  return false;
}

function installDeadClickDetector(): void {
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (!looksInteractive(target)) return;
    const el = target!.closest("button,a,[role=button],[data-sh]") as HTMLElement;

    const routeBefore = currentRoute();
    const htmlBefore = document.body.childElementCount;
    let mutated = false;
    let networked = false;

    const observer = new MutationObserver((records) => {
      if (!mutated && isResponsiveMutation(records, el)) mutated = true;
    });
    // childList only, deliberately: see isResponsiveMutation.
    observer.observe(document.body, { childList: true, subtree: true });
    const offNet = onNetwork(() => { networked = true; });

    window.setTimeout(() => {
      observer.disconnect();
      offNet();
      const navigated = currentRoute() !== routeBefore || document.body.childElementCount !== htmlBefore;
      if (mutated || networked || navigated) return;
      // Links that leave the app are handled by the browser, not by JS.
      if (el.tagName === "A" && (el as HTMLAnchorElement).href && !(el as HTMLAnchorElement).href.startsWith("javascript:")) return;

      emit("dead_click", "medium", {
        element: describeElement(el),
        path: elementPath(el),
        hadOnClick: Boolean((el as HTMLElement & { onclick?: unknown }).onclick),
        // The strongest repro hint we can cheaply capture.
        route: routeBefore,
      });
    }, DEAD_CLICK_WINDOW_MS);
  }, { capture: true, passive: true });
}

// ---------------------------------------------------------------------------
// Rage clicks
// ---------------------------------------------------------------------------
// 4+ clicks on the same element within 2s, in a small radius. Distinguished
// from legitimate rapid clicking (steppers, +/- buttons) by requiring the
// element NOT to have changed anything — otherwise a working increment button
// would page an engineer every time someone adds 10 minutes to a timer.

const RAGE_COUNT = 4;
const RAGE_WINDOW_MS = 2000;
const RAGE_RADIUS_PX = 40;

function installRageClickDetector(): void {
  let recent: { x: number; y: number; t: number; el: Element | null }[] = [];
  let productive = false;
  let lastClicked: Element | null = null;
  const offNet = onNetwork(() => { productive = true; });
  // Same structural-mutation rule as the dead-click detector: the running
  // timer must not make every rage burst look like it accomplished something.
  const observer = new MutationObserver((records) => {
    if (!productive && lastClicked && isResponsiveMutation(records, lastClicked)) productive = true;
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("click", (event) => {
    const now = Date.now();
    lastClicked = (event.target as Element | null)?.closest?.("button,a,[role=button],[data-sh]") ?? null;
    recent = recent.filter((c) => now - c.t < RAGE_WINDOW_MS);
    recent.push({ x: event.clientX, y: event.clientY, t: now, el: event.target as Element | null });
    if (recent.length < RAGE_COUNT) return;

    const first = recent[0];
    const clustered = recent.every(
      (c) => Math.abs(c.x - first.x) < RAGE_RADIUS_PX && Math.abs(c.y - first.y) < RAGE_RADIUS_PX
    );
    if (!clustered) return;

    const wasProductive = productive;
    productive = false;
    recent = [];
    emit("rage_click", wasProductive ? "low" : "high", {
      element: describeElement(first.el),
      path: elementPath(first.el),
      clicks: RAGE_COUNT,
      anythingHappened: wasProductive,
    });
  }, { capture: true, passive: true });

  window.addEventListener("pagehide", () => { offNet(); observer.disconnect(); });
}

// ---------------------------------------------------------------------------
// Stuck loading states
// ---------------------------------------------------------------------------
// A spinner visible for longer than the threshold with no network activity in
// flight is an infinite loading state: the thing it was waiting for already
// finished or never started. Requiring network silence is what separates "the
// upload is genuinely slow" from "the promise never resolved".

const SPINNER_THRESHOLD_MS = 12_000;

function installSpinnerWatchdog(): void {
  let inflight = 0;
  onNetwork(() => { inflight = Math.max(0, inflight - 1); });
  const originalFetch = window.fetch;
  window.fetch = ((...args: Parameters<typeof fetch>) => {
    inflight += 1;
    return originalFetch(...args);
  }) as typeof fetch;

  const seen = new WeakMap<Element, number>();
  const reported = new WeakSet<Element>();

  window.setInterval(() => {
    const spinners = document.querySelectorAll<HTMLElement>(
      '[data-sh="spinner"],[role="progressbar"],.animate-spin,[aria-busy="true"]'
    );
    const now = Date.now();
    spinners.forEach((el) => {
      if (!el.isConnected || el.offsetParent === null) return;
      const since = seen.get(el);
      if (since === undefined) { seen.set(el, now); return; }
      if (now - since > SPINNER_THRESHOLD_MS && !reported.has(el) && inflight === 0) {
        reported.add(el);
        emit("spinner_stuck", "high", {
          element: describeElement(el),
          path: elementPath(el),
          visibleMs: now - since,
          inflightRequests: inflight,
        });
      }
    });
  }, 3000);
}

// ---------------------------------------------------------------------------
// Errors, rejections, chunk failures
// ---------------------------------------------------------------------------

function installErrorSensors(): void {
  window.addEventListener("error", (event) => {
    // Resource load failures (img/script/link) surface as error events with a
    // target but no message; they are a different (usually less severe) bug.
    const target = event.target as HTMLElement | null;
    if (target && target !== (window as unknown as HTMLElement) && "src" in (target as HTMLImageElement)) {
      emit("network_error", "low", {
        resource: redactUrl((target as HTMLImageElement).src || ""),
        tag: target.tagName?.toLowerCase(),
      });
      return;
    }
    const err = (event as ErrorEvent).error as Error | undefined;
    const message = (event as ErrorEvent).message || "window.error";
    const isChunk = /Loading chunk|dynamically imported module|MIME type/i.test(message);
    emit(isChunk ? "chunk_load_failed" : "js_error", isChunk ? "medium" : "high", {
      message: redactText(message),
      stack: redactText(err?.stack ?? "").slice(0, 2000),
      filename: redactUrl((event as ErrorEvent).filename || ""),
      line: (event as ErrorEvent).lineno,
      col: (event as ErrorEvent).colno,
    });
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    emit("promise_rejection", "high", {
      message: redactText(message),
      stack: reason instanceof Error ? redactText(reason.stack ?? "").slice(0, 2000) : undefined,
    });
  });

  // console.error is where React logs hydration mismatches, key warnings, and
  // act() violations that never become exceptions.
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
      if (!text.includes("[Roamly]")) {
        emit("console_error", /hydrat|Minified React error/i.test(text) ? "high" : "low", {
          message: redactText(text),
        });
      }
    } catch { /* never break console */ }
    originalConsoleError(...args);
  };
}

// ---------------------------------------------------------------------------
// Network health
// ---------------------------------------------------------------------------

const SLOW_REQUEST_MS = 8000;

function installNetworkSensors(): void {
  onNetwork((obs) => {
    recordFrame("d", { u: obs.url, s: obs.status, ms: obs.durationMs });
    if (obs.status === 0) {
      emit("network_error", navigator.onLine ? "high" : "low", {
        url: obs.url, method: obs.method, error: obs.error,
        online: navigator.onLine, durationMs: obs.durationMs,
      });
      return;
    }
    if (obs.status >= 500) {
      emit("network_error", "critical", { url: obs.url, method: obs.method, status: obs.status, durationMs: obs.durationMs });
      return;
    }
    if (obs.status === 401 || obs.status === 403) {
      // Permission failures are their own class: usually an RLS policy or a
      // premium gate, and always Level 3 to fix.
      emit("network_error", "high", { url: obs.url, method: obs.method, status: obs.status, kind: "permission" });
      return;
    }
    if (obs.status === 429) {
      emit("network_error", "medium", { url: obs.url, method: obs.method, status: 429, kind: "rate_limited" });
      return;
    }
    if (obs.status >= 400) {
      emit("network_error", "medium", { url: obs.url, method: obs.method, status: obs.status });
      return;
    }
    if (obs.durationMs > SLOW_REQUEST_MS) {
      emit("slow_request", "medium", { url: obs.url, method: obs.method, durationMs: obs.durationMs });
    }
  });

  window.addEventListener("offline", () => emit("offline", "low", { at: Date.now() }));
}

// ---------------------------------------------------------------------------
// Performance and layout
// ---------------------------------------------------------------------------

function installPerformanceSensors(): void {
  if (typeof PerformanceObserver === "undefined") return;

  const safeObserve = (type: string, cb: (entries: PerformanceEntryList) => void) => {
    try {
      const po = new PerformanceObserver((list) => cb(list.getEntries()));
      po.observe({ type, buffered: true } as PerformanceObserverInit);
    } catch { /* unsupported entry type in this browser */ }
  };

  // Cumulative layout shift: only report the session total once, at unload,
  // and only when it is bad enough to be a real visual defect (>0.25 is
  // Google's "poor" threshold).
  let cls = 0;
  safeObserve("layout-shift", (entries) => {
    for (const entry of entries) {
      const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
      if (!shift.hadRecentInput) cls += shift.value;
    }
  });
  window.addEventListener("pagehide", () => {
    if (cls > 0.25) emit("layout_shift", cls > 0.5 ? "medium" : "low", { cls: Number(cls.toFixed(3)) });
  });

  // Long tasks block interaction. One is noise; a sustained run is a freeze.
  let longTaskMs = 0;
  let longTaskCount = 0;
  safeObserve("longtask", (entries) => {
    for (const entry of entries) {
      longTaskMs += entry.duration;
      longTaskCount += 1;
      if (entry.duration > 2000) {
        emit("long_task", "medium", { durationMs: Math.round(entry.duration), name: entry.name });
      }
    }
  });
  window.setInterval(() => {
    if (longTaskCount > 20 && longTaskMs > 5000) {
      emit("long_task", "high", { signal: "sustained_jank", count: longTaskCount, totalMs: Math.round(longTaskMs) });
    }
    longTaskMs = 0; longTaskCount = 0;
  }, 60_000);

  // Interaction latency (INP-style). A click that takes >1s to paint feels broken.
  safeObserve("event", (entries) => {
    for (const entry of entries) {
      const e = entry as PerformanceEntry & { interactionId?: number; processingEnd?: number };
      if (!e.interactionId) continue;
      if (entry.duration > 1000) {
        emit("long_task", "medium", { signal: "slow_interaction", name: entry.name, durationMs: Math.round(entry.duration) });
      }
    }
  });

  // Memory pressure is the leading indicator of the leak that eventually
  // crashes long study sessions. Chrome-only; absent elsewhere, which is fine.
  const perfMemory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (perfMemory) {
    let peak = 0;
    window.setInterval(() => {
      const used = perfMemory.usedJSHeapSize;
      const ratio = used / perfMemory.jsHeapSizeLimit;
      if (ratio > 0.9 && used > peak * 1.2) {
        peak = used;
        emit("memory_pressure", "high", { usedMb: Math.round(used / 1048576), ratio: Number(ratio.toFixed(2)) });
      }
    }, 60_000);
  }
}

// ---------------------------------------------------------------------------
// Navigation + viewport
// ---------------------------------------------------------------------------

function installNavigationSensors(): void {
  let lastRoute = currentRoute();
  window.addEventListener("hashchange", () => {
    const next = currentRoute();
    recordFrame("n", { from: lastRoute, to: next });
    // A route change that renders nothing is a broken route — the SPA
    // equivalent of a 404 that returns 200.
    const at = next;
    window.setTimeout(() => {
      if (currentRoute() !== at) return;
      const main = document.querySelector("main") || document.getElementById("root");
      if (main && main.textContent && main.textContent.trim().length < 20) {
        emit("nav_failed", "high", { route: at, from: lastRoute, reason: "empty_view" });
      }
      lastRoute = at;
    }, 1500);
  });

  // Mobile layout failure: content wider than the viewport means horizontal
  // scroll on a phone, which reliably makes controls unreachable.
  const checkViewport = () => {
    if (window.innerWidth > 640) return;
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    if (overflow > 16) {
      emit("layout_shift", "medium", {
        signal: "horizontal_overflow", overflowPx: overflow,
        viewport: window.innerWidth, route: currentRoute(),
      });
    }
  };
  window.addEventListener("resize", () => window.setTimeout(checkViewport, 400), { passive: true });
  window.setTimeout(checkViewport, 3000);
}

// ---------------------------------------------------------------------------
// Form health
// ---------------------------------------------------------------------------
// Forms are where signups and payments die. We never read values — only
// whether fields were filled and whether submission produced anything.

function installFormSensors(): void {
  document.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    if (!form || form.tagName !== "FORM") return;
    const fields = Array.from(form.elements).filter((el) => "name" in el) as HTMLInputElement[];
    const filled = fields.filter((f) => !isSensitiveField(f) ? Boolean(f.value) : f.value.length > 0).length;

    let responded = false;
    const offNet = onNetwork(() => { responded = true; });
    window.setTimeout(() => {
      offNet();
      if (responded) return;
      emit("dead_click", "high", {
        signal: "form_submit_no_request",
        form: describeElement(form),
        path: elementPath(form),
        fieldCount: fields.length,
        filledCount: filled,
      });
    }, 2500);
  }, true);
}

// ---------------------------------------------------------------------------

export function installSensors(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  installNetworkMonitor();
  installErrorSensors();
  installNetworkSensors();
  installDeadClickDetector();
  installRageClickDetector();
  installSpinnerWatchdog();
  installPerformanceSensors();
  installNavigationSensors();
  installFormSensors();
}

/** Called by ErrorBoundary so React render crashes carry component stacks. */
export function reportReactCrash(message: string, componentStack: string, stack?: string): void {
  emit("react_error", "critical", {
    message: redactText(message),
    componentStack: redactText(componentStack).slice(0, 2000),
    stack: redactText(stack ?? "").slice(0, 2000),
  });
}
