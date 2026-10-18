// Serves the full production App with an offline Supabase stand-in (sample signed-in account) for the promo.
// Run from the repo root:  npx vite --config promo-output/focus-harness/vite.config.ts
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
const fake = path.resolve(__dirname, "fake-supabase.ts");
const swapSupabase = (): Plugin => ({
  name: "promo-swap-supabase", enforce: "pre",
  resolveId(id, importer) { if (/(^|\/)supabaseClient(\.ts)?$/.test(id) && importer && !importer.endsWith("fake-supabase.ts")) return fake; },
});
export default defineConfig({ root: path.resolve(__dirname, "../.."), plugins: [swapSupabase(), react()], server: { port: 5191, strictPort: true } });
