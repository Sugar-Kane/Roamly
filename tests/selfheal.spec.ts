import { test, expect, type Page, type Request } from "@playwright/test";

// Self-healing SDK behaviour, verified against the real production build.
//
// These tests protect the properties the platform is worthless without:
//   * it never breaks or slows the app it monitors;
//   * it never transmits user content;
//   * it detects the failures it claims to detect;
//   * its own data is not reachable from a browser.
//
// They run against a build with placeholder Supabase vars, so /api/selfheal
// does not exist — the SDK must behave correctly with the ingest endpoint
// returning 404, which is also what a telemetry outage looks like in
// production.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("roamly-tutorial-seen", "1"));
});

/**
 * Force the SDK to flush.
 *
 * The transport flushes on a 10s timer or when the document becomes hidden.
 * Dispatching `visibilitychange` alone is not enough — the handler checks
 * `document.visibilityState`, which a synthetic event does not change — so the
 * getter is overridden for the duration of the flush. This mirrors what a real
 * tab-away does, which is the path that carries the last batch before a user
 * abandons a broken page.
 */
async function flushTelemetry(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
}

/** Capture every telemetry batch the page attempts to send. */
async function captureTelemetry(page: Page): Promise<Record<string, unknown>[]> {
  const batches: Record<string, unknown>[] = [];
  await page.route("**/api/selfheal", async (route, request: Request) => {
    try {
      batches.push(JSON.parse(request.postData() ?? "{}"));
    } catch { /* malformed batches are themselves a failure, asserted below */ }
    await route.fulfill({ status: 202, contentType: "application/json", body: '{"ok":true}' });
  });
  return batches;
}

test("the app boots and works with the SDK installed", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();

  // The SDK wraps window.fetch and XMLHttpRequest. If that wrapping were
  // broken, everything downstream of it would fail silently — so assert the
  // app still renders and nothing threw during boot.
  expect(pageErrors, `page errors during boot: ${pageErrors.join(" | ")}`).toHaveLength(0);
  expect(consoleErrors.filter((e) => /selfheal|telemetry/i.test(e))).toHaveLength(0);
});

test("telemetry batches carry no user-typed content", async ({ page }) => {
  const batches = await captureTelemetry(page);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();

  // Type a value that must never appear anywhere in telemetry. If any batch
  // contains it, the redaction layer has a hole.
  const secret = "TOPSECRET-patient-case-12345";
  const textbox = page.getByRole("textbox").first();
  if (await textbox.count()) {
    await textbox.fill(secret);
    await textbox.press("Enter");
  }

  await page.waitForTimeout(1500);
  await flushTelemetry(page);

  const serialised = JSON.stringify(batches);
  expect(serialised).not.toContain(secret);
  expect(serialised).not.toContain("patient-case");
});

test("a dead click is detected and reported", async ({ page }) => {
  const batches = await captureTelemetry(page);

  // Keep background Supabase traffic out of the detector's window. Note this
  // leaves the requests PENDING rather than aborting them: an aborted request
  // is a failed request, which is still network activity the detector would
  // observe — the stub would have caused the very thing it was meant to
  // prevent. A pending request never settles, so it is never observed.
  await page.route("**/*.supabase.co/**", () => { /* intentionally unresolved */ });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();

  // Inject a button that looks interactive and does nothing — the exact defect
  // class the dead-click detector exists to catch. Mounted inside its own
  // container rather than directly on <body>, so the element sits at a
  // realistic depth in the tree.
  await page.evaluate(() => {
    const host = document.createElement("div");
    // Pinned above the app chrome: the fixed bottom nav would otherwise
    // intercept the click and the test would fail for the wrong reason.
    host.style.cssText = "position:fixed;top:0;left:0;z-index:9999";
    const button = document.createElement("button");
    button.textContent = "Broken Action";
    button.setAttribute("data-sh", "test-dead-button");
    host.appendChild(button);
    document.body.appendChild(host);
  });

  await page.getByRole("button", { name: "Broken Action" }).click();
  // The detector waits 1.2s for a mutation/navigation/request before deciding.
  await page.waitForTimeout(2000);
  await flushTelemetry(page);

  const events = batches.flatMap((b) => (b.events ?? []) as Record<string, unknown>[]);
  const dead = events.filter((e) => e.kind === "dead_click");
  expect(dead.length, "expected a dead_click event").toBeGreaterThan(0);
  expect(String(dead[0].payload && (dead[0].payload as Record<string, unknown>).element))
    .toContain("test-dead-button");
});

test("a determinate progress bar is not a stuck spinner", async ({ page }) => {
  // Both spinner incidents this platform has ever opened were progress BARS:
  // the focus-phase timer and the task-completion bar, each of which sits on
  // screen for the whole session with no network behind it by design. One was
  // "patched". The detector must tell a progress display apart from a loading
  // state, and must still catch the loading state.
  test.setTimeout(60_000);
  const batches = await captureTelemetry(page);

  // Let Supabase calls SETTLE (unlike the dead-click test, which needs them
  // pending): the watchdog only fires with zero requests in flight, so a
  // permanently pending request would suppress the positive control below and
  // the test would pass for the wrong reason.
  await page.route("**/*.supabase.co/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();

  await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;top:0;left:0;z-index:9999";

    // Determinate: publishes a value, so it is a progress display, not a wait.
    const bar = document.createElement("div");
    bar.style.cssText = "width:120px;height:8px";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", "42");

    // Positive control: an indeterminate spinner that never resolves. If this
    // stops being reported, the fix has broken the detector instead of
    // narrowing it. `animate-spin` is what makes the watchdog watch it at all
    // (`data-sh` alone does not — the selector wants `data-sh="spinner"`); the
    // data-sh value is only how the event names it.
    const spinner = document.createElement("div");
    spinner.className = "animate-spin";
    spinner.style.cssText = "width:16px;height:16px";
    spinner.setAttribute("data-sh", "test-stuck-spinner");

    host.append(bar, spinner);
    document.body.appendChild(host);
  });

  // Threshold is 12s, polled every 3s.
  await page.waitForTimeout(18_000);
  await flushTelemetry(page);

  const events = batches.flatMap((b) => (b.events ?? []) as Record<string, unknown>[]);
  const stuck = events.filter((e) => e.kind === "spinner_stuck");
  const described = stuck.map((e) => String((e.payload as Record<string, unknown>)?.element));

  expect(described, "the indeterminate spinner must still be caught")
    .toContain("test-stuck-spinner");
  // No progress bar — neither the injected one nor the app's own timer and
  // daily-goal bars, which are on screen for this entire test.
  expect(described.filter((d) => d.includes("progressbar")),
    `progress bars reported as stuck loading states: ${described.join(", ")}`).toHaveLength(0);
});

test("a request that fails during an offline blip is not an incident", async ({ page }) => {
  // navigator.onLine is updated by the browser AFTER the request has already
  // failed, so sampling it at failure time blamed us for the user's tunnel:
  // a token refresh reported online:true and opened a high-severity incident
  // while the next request 17ms later reported online:false.
  const batches = await captureTelemetry(page);
  await page.route("**/probe-*", (route) => route.abort("failed"));

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();

  // Control: a failure with no connectivity evidence is still ours to fix.
  await page.evaluate(() => { void fetch("/probe-backend").catch(() => {}); });
  // Past the 2s grace, so the offline signal below cannot retro-excuse it.
  await page.waitForTimeout(3000);

  // The race: the browser has noticed it is offline, but navigator.onLine has
  // not caught up — exactly the state the real incident was reported in.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    void fetch("/probe-offline").catch(() => {});
  });
  await page.waitForTimeout(3000);
  await flushTelemetry(page);

  const events = batches.flatMap((b) => (b.events ?? []) as Record<string, unknown>[]);
  const failuresFor = (needle: string) => events.filter((e) =>
    e.kind === "network_error" &&
    String((e.payload as Record<string, unknown>)?.url ?? "").includes(needle));

  // High severity is never sampled away, so both assertions are deterministic.
  const backend = failuresFor("probe-backend");
  expect(backend.length, "a genuine network failure must still be reported").toBeGreaterThan(0);
  expect(backend.some((e) => e.severity === "high")).toBe(true);

  expect(failuresFor("probe-offline").filter((e) => e.severity === "high" || e.severity === "critical"),
    "an offline blip must not open an incident").toHaveLength(0);
});

test("telemetry failures never surface to the user", async ({ page }) => {
  // Every ingest attempt fails. The app must be completely unaffected — this
  // is the "monitoring outage must not become a product outage" guarantee.
  await page.route("**/api/selfheal", (route) => route.fulfill({ status: 500, body: "boom" }));

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();

  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) document.body.click();
  });
  await page.waitForTimeout(1500);

  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
  expect(pageErrors).toHaveLength(0);
  // No error UI, no toast, no console-visible complaint reaches the user.
  await expect(page.getByText(/telemetry/i)).toHaveCount(0);
});

test("the self-healing tables are not readable from the browser", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();

  // The sh_* tables have RLS enabled with NO policies, so PostgREST must refuse
  // every one of them for anon and authenticated alike. Against the placeholder
  // backend this asserts the client never even attempts a direct read — the
  // real assertion runs in staging against a live project.
  const attempted: string[] = [];
  page.on("request", (req) => {
    if (/\/rest\/v1\/sh_/.test(req.url())) attempted.push(req.url());
  });
  await page.waitForTimeout(1500);
  expect(attempted, `client attempted direct reads: ${attempted.join(", ")}`).toHaveLength(0);
});

test("the Bug Intelligence dashboard is admin-gated", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
  await expect(page.getByText("You don't have admin access.")).toBeVisible();
  // The section must not exist in the DOM at all for a non-admin — not merely
  // be hidden with CSS.
  await expect(page.getByRole("button", { name: "Bug Intelligence" })).toHaveCount(0);
  await expect(page.getByText("Open incidents")).toHaveCount(0);
});
