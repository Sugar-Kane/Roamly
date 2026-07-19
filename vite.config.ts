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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), seoVerification()],
})
