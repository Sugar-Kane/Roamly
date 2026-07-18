// Client-side head manager for the SPA. Each view gets its own title, meta
// description, canonical URL, Open Graph / Twitter values, and robots
// directive. This runs on every view change so a crawler that executes our JS
// (and the browser tab / share preview) sees per-page metadata instead of the
// single static shell. Prerendering the public pages to static HTML is a
// separate, later step; this hook is the runtime half and stays correct
// alongside it.
//
// Canonical host is www (the production domain). Only genuinely public pages
// are marked indexable; every personal/app surface is noindex.

export const SITE_ORIGIN = "https://www.roamlyflow.com";

type SeoEntry = {
  title: string;
  description: string;
  path: string;    // canonical path for this view
  index: boolean;  // true = public + indexable; false = noindex
};

// Copy avoids em dashes and unsupported superlatives by design.
const VIEW_SEO: Record<string, SeoEntry> = {
  focus: {
    title: "Roamly Flow: focus timer and study planner for PA school",
    description: "A free Pomodoro style focus timer and study planner built for PA school. Plan your sessions, stay focused, and track progress toward exams. No account needed.",
    path: "/",
    index: true,
  },
  premium: {
    title: "Roamly Flow Premium: pricing and features",
    description: "Roamly Flow Premium adds planned study scheduling, AI note uploads, full analytics history, and live study rooms. See what is included and how billing works.",
    path: "/premium",
    index: true,
  },
  tasks: { title: "Tasks | Roamly Flow", description: "Your study tasks in Roamly Flow.", path: "/tasks", index: false },
  analytics: { title: "Analytics | Roamly Flow", description: "Your focus and study analytics in Roamly Flow.", path: "/analytics", index: false },
  rooms: { title: "Study rooms | Roamly Flow", description: "Live study rooms in Roamly Flow.", path: "/rooms", index: false },
  garden: { title: "Garden | Roamly Flow", description: "Your Roamly Flow garden and companions.", path: "/garden", index: false },
  admin: { title: "Admin | Roamly Flow", description: "Roamly Flow admin.", path: "/admin", index: false },
};

function upsertMeta(attr: "name" | "property", key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// Apply the metadata for a given view. Unknown views fall back to the home
// (focus) entry so the head is never left stale.
export function applySeo(view: string): void {
  const e = VIEW_SEO[view] ?? VIEW_SEO.focus;
  const url = SITE_ORIGIN + e.path;
  document.title = e.title;
  upsertMeta("name", "description", e.description);
  upsertCanonical(url);
  upsertMeta("property", "og:title", e.title);
  upsertMeta("property", "og:description", e.description);
  upsertMeta("property", "og:url", url);
  upsertMeta("name", "twitter:title", e.title);
  upsertMeta("name", "twitter:description", e.description);
  upsertMeta("name", "robots", e.index ? "index, follow" : "noindex, follow");
}
