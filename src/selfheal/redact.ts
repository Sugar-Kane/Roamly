// Privacy layer. Nothing leaves the browser without passing through here.
//
// The rule this file enforces: the platform collects SHAPE, not CONTENT. We
// need to know that the email field was filled and the submit failed — never
// what the email was. Study notes in particular are treated as sensitive: a PA
// student's uploaded lecture material can contain patient case details, so it
// is never captured, only measured (length, type, whether it parsed).
//
// Defence in depth: this is layer 1 of 3. Layer 2 is the server scrubber in
// api/_scrub.ts (because a bug here must not become a breach), layer 3 is
// the DB's absence of any client read path. Assume this layer WILL be bypassed
// by some future code path and design the others accordingly.

/** Input types whose values are never read, even masked. */
const NEVER_READ_TYPES = new Set(["password", "email", "tel", "number", "date", "file", "hidden"]);

/** name/id/autocomplete substrings that mark a field as sensitive. */
const SENSITIVE_NAME = /pass|pwd|secret|token|auth|card|cc|cvv|cvc|iban|ssn|sin|dob|birth|phone|tel|email|address|zip|postal|medical|diagnos|patient|note|journal/i;

/** Values that look like credentials or PII no matter which field they came from. */
const VALUE_PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.]{2,}/g, "<email>"],
  [/\b(?:\d[ -]*?){13,19}\b/g, "<card>"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "<ssn>"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<api-key>"],
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "<jwt>"],
  [/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer <token>"],
  [/\b(?:\+?\d[\s()-]{0,2}){9,15}\b/g, "<phone>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
];

/** Query/hash params stripped from any captured URL. */
const SENSITIVE_PARAMS = /^(access_token|refresh_token|token|code|apikey|api_key|key|password|email|session_id|signature)$/i;

const MAX_STRING = 400;

/** Scrub free text: credential-shaped substrings out, length capped. */
export function redactText(input: unknown): string {
  let s = typeof input === "string" ? input : safeStringify(input);
  for (const [re, replacement] of VALUE_PATTERNS) s = s.replace(re, replacement);
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[+${s.length - MAX_STRING}]` : s;
}

/** Strip credentials and identifiers out of a URL, keeping only its shape. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw, typeof location !== "undefined" ? location.href : "https://roamly.app");
    const keep = new URLSearchParams();
    u.searchParams.forEach((value, key) => {
      keep.set(key, SENSITIVE_PARAMS.test(key) ? "<redacted>" : redactText(value).slice(0, 40));
    });
    u.search = keep.toString();
    u.hash = u.hash.includes("access_token") || u.hash.includes("refresh_token") ? "#<redacted>" : u.hash;
    // Numeric and uuid path segments are identifiers; collapse them so URLs
    // group into routes instead of exploding into one bucket per user.
    u.pathname = u.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id")
      .replace(/\/\d{2,}/g, "/:id");
    return `${u.origin === location?.origin ? "" : u.origin}${u.pathname}${u.search}${u.hash}`.slice(0, 300);
  } catch {
    return redactText(raw).slice(0, 300);
  }
}

/**
 * Should this element's VALUE ever be read? Anything typed by a user is
 * assumed sensitive unless it is explicitly opted in with data-sh-safe.
 */
export function isSensitiveField(el: Element | null): boolean {
  if (!el) return false;
  const node = el as HTMLInputElement;
  if (node.dataset?.shSafe === "true") return false;
  if (node.closest?.("[data-sh-private]")) return true;
  const type = (node.type || "").toLowerCase();
  if (NEVER_READ_TYPES.has(type)) return true;
  const tag = node.tagName?.toLowerCase();
  // Free-text areas are where study notes and journals live.
  if (tag === "textarea" || node.isContentEditable) return true;
  const hay = `${node.name || ""} ${node.id || ""} ${node.getAttribute?.("autocomplete") || ""} ${node.getAttribute?.("aria-label") || ""}`;
  return SENSITIVE_NAME.test(hay);
}

/**
 * A stable, non-identifying description of an element: what it is and where it
 * sits, never what it says if what it says could be personal. Used for dead
 * clicks, replay, and as the `component` hint the AI uses to find source files.
 */
export function describeElement(el: Element | null): string {
  if (!el) return "unknown";
  const node = el as HTMLElement;
  const explicit = node.dataset?.sh || node.closest?.("[data-sh]")?.getAttribute("data-sh");
  if (explicit) return explicit.slice(0, 60);

  const parts: string[] = [node.tagName.toLowerCase()];
  if (node.id && !/^[0-9a-f-]{20,}$/i.test(node.id)) parts.push(`#${node.id.slice(0, 30)}`);
  const role = node.getAttribute?.("role");
  if (role) parts.push(`[role=${role}]`);
  const testId = node.dataset?.testid;
  if (testId) parts.push(`[testid=${testId.slice(0, 30)}]`);

  // Button/link labels are UI copy, not user data — but they can be a username
  // in a friends list, so they still go through the value scrubber.
  const tag = node.tagName.toLowerCase();
  if ((tag === "button" || tag === "a") && !isSensitiveField(node)) {
    const label = (node.getAttribute("aria-label") || node.textContent || "").trim().replace(/\s+/g, " ");
    if (label) parts.push(`"${redactText(label).slice(0, 40)}"`);
  }
  return parts.join("").slice(0, 120);
}

/** Short CSS-ish path for locating the element in source. */
export function elementPath(el: Element | null, depth = 4): string {
  const chain: string[] = [];
  let node: Element | null = el;
  while (node && chain.length < depth && node.tagName) {
    const id = (node as HTMLElement).dataset?.sh;
    chain.unshift(id ? `[data-sh=${id}]` : node.tagName.toLowerCase());
    node = node.parentElement;
  }
  return chain.join(">").slice(0, 200);
}

/** Deep-scrub an arbitrary payload object before it is queued. */
export function redactPayload(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 4) return "<deep>";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactPayload(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (n++ > 30) break;
      out[k] = SENSITIVE_NAME.test(k) ? "<redacted>" : redactPayload(v, depth + 1);
    }
    return out;
  }
  return "<unserialisable>";
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "object" ? JSON.stringify(v) ?? String(v) : String(v);
  } catch {
    return String(v);
  }
}
