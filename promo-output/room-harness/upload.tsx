// Renders the production UploadTasksPanel (unchanged) for the promo's AI-upload screens.
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../src/fonts/fonts.css";
import { UploadTasksPanel, currentUploadPeriod } from "../../src/UploadTasks";
import { HARNESS_SESSION } from "./fake-supabase";
const profile = { id: "me", username: "alex", is_premium: false, ai_uploads_period: currentUploadPeriod(), ai_uploads_count: 0, ai_credits: 0 };
createRoot(document.getElementById("root")!).render(
  <div className="min-h-screen bg-background text-foreground"><main className="mx-auto max-w-2xl px-4 py-6">
    <UploadTasksPanel profile={profile as never} session={HARNESS_SESSION as never} onImported={() => {}} onUpgrade={() => {}} onBuyCredits={() => {}} />
  </main></div>
);
