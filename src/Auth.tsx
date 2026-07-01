import { useState } from "react";
import { X, Mail, LogIn } from "lucide-react";
import { supabase, supabaseEnabled } from "./supabaseClient";

export function AuthPanel({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!supabaseEnabled || !supabase) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm" onClick={onClose}>
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-muted-foreground">Accounts aren't set up yet. Check back soon.</p>
          <button onClick={onClose} className="mt-4 w-full rounded-full py-2 text-sm text-muted-foreground">Close</button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    setLoading(true);
    // Called directly on `supabase.auth` (not extracted into a variable first)
    // so the method keeps its `this` binding to the client instance.
    const { error: authError } = mode === "signup"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) { setError(authError.message); return; }
    onClose();
  };

  const withGoogle = async () => {
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (authError) setError(authError.message);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-5 top-5 text-muted-foreground"><X size={18} /></button>
        <h3 className="font-display text-xl font-semibold">{mode === "signup" ? "Create your account" : "Welcome back"}</h3>
        <button onClick={withGoogle} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card py-2.5 text-sm font-semibold transition hover:border-primary/40">
          <LogIn size={16} /> Continue with Google
        </button>
        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>
        <div className="space-y-2.5">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password"
            className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <button onClick={submit} disabled={loading} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full gradient-primary py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">
          <Mail size={16} /> {mode === "signup" ? "Sign up" : "Sign in"}
        </button>
        <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="mt-3 w-full text-center text-xs text-muted-foreground underline">
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}
