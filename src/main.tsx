import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary";
import { initErrorCapture } from "./errors";

initErrorCapture();

// A deploy replaces the hashed chunk files, so a tab opened before the deploy
// can fail to lazy-load a chunk (the SPA fallback serves index.html where JS
// was expected — the "'text/html' is not a valid JavaScript MIME type" error).
// Vite fires this event for exactly that case; reload once to pick up the new
// build. The flag stops a reload loop if the failure is something else, and
// clears after the fresh load proves healthy.
window.addEventListener("vite:preloadError", (event) => {
  if (sessionStorage.getItem("roamly-chunk-reload") === "1") return;
  sessionStorage.setItem("roamly-chunk-reload", "1");
  event.preventDefault();
  window.location.reload();
});
window.setTimeout(() => sessionStorage.removeItem("roamly-chunk-reload"), 15_000);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
