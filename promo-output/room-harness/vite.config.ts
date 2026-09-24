// Serves the room harness from the repo root so Tailwind/PostCSS use the app's real config.
// Run from the repo root:  npx vite --config promo-output/room-harness/vite.config.ts
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
const fake = path.resolve(__dirname, "fake-supabase.ts");
const swapSupabase = (): Plugin => ({
  name: "promo-swap-supabase", enforce: "pre",
  resolveId(id) { if (/(^|\/)supabaseClient(\.ts)?$/.test(id)) return fake; },
});
export default defineConfig({ root: path.resolve(__dirname, "../.."), plugins: [swapSupabase(), react()], server: { port: 5190, strictPort: true } });
