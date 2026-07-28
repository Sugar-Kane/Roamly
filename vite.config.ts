import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Injects search-engine site-verification meta tags at build time, but only
// when the matching env var is provided. No token is ever committed to the
// repo: set VITE_GSC_VERIFICATION (Google Search Console) and/or
// VITE_BING_VERIFICATION (Bing Webmaster Tools) in the deploy environment to
// activate them. With neither set (the default), nothing is injected.
function seoVerification(): Plugin {
  return {
    name: 'seo-verification',
    transformIndexHtml() {
      const tags = []
      const google = process.env.VITE_GSC_VERIFICATION
      const bing = process.env.VITE_BING_VERIFICATION
      if (google) tags.push({ tag: 'meta', attrs: { name: 'google-site-verification', content: google }, injectTo: 'head' as const })
      if (bing) tags.push({ tag: 'meta', attrs: { name: 'msvalidate.01', content: bing }, injectTo: 'head' as const })
      return tags
    },
  }
}

// Stamp the commit being built into VITE_RELEASE, so telemetry can say WHICH
// deploy a session was running.
//
// Without this, selfheal/session.ts falls back to "dev" and every production
// session reported release "dev" — which made `sh_incidents.release`,
// `suspected_release`, and any "did that deploy cause this?" triage useless,
// the one question the field exists to answer. A dashboard environment
// variable cannot do this job: it would be a fixed string that goes stale on
// the next deploy. Vercel exposes the real SHA at build time instead.
//
// Assigning to process.env here (rather than `define`) is deliberate: it is
// exactly how VITE_SUPABASE_* already reach the bundle, so the value flows
// through Vite's normal env pipeline with no second mechanism to reason about.
// An explicit VITE_RELEASE still wins, so other hosts can set it directly.
if (!process.env.VITE_RELEASE) {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || ''
  if (sha) process.env.VITE_RELEASE = sha.slice(0, 7)
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), seoVerification()],
})
