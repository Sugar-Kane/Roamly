// Catches React render crashes so a single component error shows a recovery
// screen instead of a blank white page, and reports the crash to the admin
// dashboard. Wraps the whole app in main.tsx.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "./errors";
import { reportReactCrash, forceReplay, flushTelemetry } from "./selfheal";

type Props = { children: ReactNode };
type State = { crashed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error.message || "render crash", `${error.stack ?? ""}\n${info.componentStack ?? ""}`);
    // Also feed the self-healing pipeline: the component stack is what lets the
    // AI jump straight to the failing file instead of guessing from a message.
    // A render crash always warrants a replay trace and an immediate flush —
    // the user is about to reload, taking the in-memory queue with them.
    reportReactCrash(error.message || "render crash", info.componentStack ?? "", error.stack);
    forceReplay();
    void flushTelemetry(true);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6 text-center text-foreground">
        <div className="max-w-sm">
          <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Roamly Flow hit an unexpected error. Reloading usually fixes it, and your saved data is safe.
          </p>
          <button onClick={() => window.location.reload()}
            className="mt-5 rounded-full gradient-primary px-6 py-2.5 font-semibold text-white shadow-glow transition active:scale-95">
            Reload Roamly Flow
          </button>
        </div>
      </div>
    );
  }
}
