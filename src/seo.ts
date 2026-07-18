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

import seoRoutes from "./seo-routes.json";

export const SITE_ORIGIN = "https://www.roamlyflow.com";

type SeoEntry = {
  view: string;
  title: string;
  description: string;
  path: string;    // canonical path for this view
  index: boolean;  // true = public + indexable; false = noindex
};

// Single source of truth for per-route metadata, shared with the build-time
// prerender script (scripts/prerender.mjs) via seo-routes.json so runtime and
// static HTML never drift. Copy avoids em dashes and unsupported claims.
const VIEW_SEO: Record<string, SeoEntry> = Object.fromEntries(
  (seoRoutes as SeoEntry[]).map((r) => [r.view, r]),
);

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
