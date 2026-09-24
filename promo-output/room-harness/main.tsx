// Renders the production RoomsLive component (unchanged) with sample data for the promo.
import { createRoot } from "react-dom/client";
import "../../src/index.css";
// The app loads its fonts from Google Fonts; the harness uses the same families from local files (offline render).
import "../src/fonts/fonts.css";
import { RoomsLive } from "../../src/RoomsLive";
import { HARNESS_SESSION } from "./fake-supabase";
const noop = () => {};
const props = {
  session: HARNESS_SESSION as never, profile: { id: "me", username: "alex", is_premium: false } as never, isPremium: false,
  gateThen: (fn: () => void) => fn(), onSignIn: noop, onNeedUsername: noop, onOpenFriends: noop,
  targetRoomId: null, onTargetConsumed: noop, soundAuto: false, completionSoundEnabled: false, onCelebrate: noop,
  onInRoom: noop, leaveSignal: 0, pipSupported: true, pipWindow: null, onPopOut: noop, onClosePip: noop,
  onImportedTasks: noop, onUpgrade: noop,
};
createRoot(document.getElementById("root")!).render(
  <div className="min-h-screen bg-background text-foreground"><main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
    <RoomsLive {...props} />
  </main></div>
);
