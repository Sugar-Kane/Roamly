import { useEffect, useRef, useState } from "react";
import { X, Mail, LogIn } from "lucide-react";
import { supabase, supabaseEnabled } from "./supabaseClient";
import { Modal } from "./Modal";

// ---- Cloudflare Turnstile (bot protection on sign-up / sign-in) ----
// Renders only when VITE_TURNSTILE_SITE_KEY is configured; without it the auth
// form works exactly as before (dev, tests, and pre-setup deploys unaffected).
// The token is passed as Supabase Auth's captchaToken and verified by
// Supabase's Attack Protection (configure Turnstile + secret key there).
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window { turnstile?: TurnstileApi; onRoamlyTurnstileLoad?: () => void }
}

let turnstileLoader: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (!turnstileLoader) {
    turnstileLoader = new Promise((resolve) => {
      if (window.turnstile) { resolve(); return; }
      window.onRoamlyTurnstileLoad = () => resolve();
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onRoamlyTurnstileLoad";
      script.async = true;
      // If the script can't load, resolve anyway: the widget simply won't
      // render, and Supabase will reject the attempt with a captcha error the
      // form surfaces (rather than the form hanging forever).
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }
  return turnstileLoader;
}

function TurnstileWidget({ onToken, resetSignal }: { onToken: (token: string | null) => void; resetSignal: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;
    void loadTurnstile().then(() => {
      if (cancelled || !hostRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(hostRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "auto",
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* already gone */ }
      }
      widgetIdRef.current = null;
    };
  }, []);

  // Tokens are single-use: a failed submit consumes one, so the form bumps
  // resetSignal to issue a fresh challenge.
  useEffect(() => {
    if (resetSignal === 0) return;
    if (widgetIdRef.current && window.turnstile) {
      try { window.turnstile.reset(widgetIdRef.current); } catch { /* ignore */ }
    }
    onTokenRef.current(null);
  }, [resetSignal]);

  return <div ref={hostRef} className="mt-2.5 flex justify-center" />;
}

export function AuthPanel({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set after a successful sign-up while email confirmation is pending — the
  // modal must NOT close silently, or the user has no idea an email was sent.
  const [confirmSentTo, setConfirmSentTo] = useState<string | null>(null);
  // Turnstile token for signUp/signInWithPassword; null when the widget is
  // absent (no site key) or awaiting completion.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  const failCaptcha = (message: string) => {
    setError(message);
    // A consumed/failed token can't be reused; get a fresh challenge.
    if (TURNSTILE_SITE_KEY) setCaptchaReset((n) => n + 1);
  };

  if (!supabaseEnabled || !supabase) {
    return (
      <Modal label="Accounts unavailable" onClose={onClose}
        cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-xl">
        <p className="text-sm text-muted-foreground">Accounts aren't set up yet. Check back soon.</p>
        <button onClick={onClose} className="mt-4 w-full rounded-full py-2 text-sm text-muted-foreground">Close</button>
      </Modal>
    );
  }

  const client = supabase; // narrowed to non-null for the closures below

  const submit = async () => {
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    // Basic strength check on sign-up (the free stand-in for Supabase Pro's
    // leaked-password protection): 8+ chars with at least one letter and one
    // digit. Sign-in doesn't re-validate — existing accounts keep working.
    if (mode === "signup" && !(password.length >= 8 && /[a-zA-Z]/.test(password) && /\d/.test(password))) {
      setError("Use at least 8 characters, including a letter and a number.");
      return;
    }
    setError(null);
    setLoading(true);
    if (mode === "signup") {
      const { data, error: authError } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin, ...(captchaToken ? { captchaToken } : {}) },
      });
      setLoading(false);
      if (authError) {
        failCaptcha(/captcha/i.test(authError.message)
          ? "Please complete the verification and try again."
          : /rate limit/i.test(authError.message) || authError.status === 429
            ? "Too many sign-up emails right now. Wait a few minutes and try again."
            : authError.message);
        return;
      }
      // Supabase returns a fake user with no identities (and sends no email)
      // when the address is already registered — surface that instead of
      // closing the modal as if it worked.
      if (data.user && data.user.identities?.length === 0) {
        setError("That email is already registered. Sign in instead.");
        setMode("signin");
        return;
      }
      // Email confirmation pending: no session yet. Show the check-your-inbox
      // state; the account activates when they click the link.
      if (!data.session) { setConfirmSentTo(email); return; }
      onClose();
      return;
    }
    const { error: authError } = await client.auth.signInWithPassword({
      email,
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    });
    setLoading(false);
    if (authError) {
      failCaptcha(/captcha/i.test(authError.message)
        ? "Please complete the verification and try again."
        : /email not confirmed/i.test(authError.message)
          ? "Your email isn't verified yet. Click the link in your confirmation email (check spam), then sign in."
          : authError.message);
      return;
    }
    onClose();
  };

  const withGoogle = async () => {
    setError(null);
    const { error: authError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (authError) setError(authError.message);
  };

  if (confirmSentTo) {
    return (
      <Modal label="Check your email" onClose={onClose}
        cardClassName="relative w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-xl">
        <button onClick={onClose} aria-label="Close" className="absolute right-5 top-5 text-muted-foreground"><X size={18} /></button>
        <div className="grid place-items-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><Mail size={22} /></div>
        </div>
        <h3 className="mt-3 text-center font-display text-xl font-semibold">Check your email</h3>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{confirmSentTo}</span>.
          Click it to activate your account.
        </p>
        <p className="mt-2 rounded-xl border border-dashed border-border p-2.5 text-center text-xs text-muted-foreground">
          Nothing there after a minute? <span className="font-medium text-foreground">Check your spam folder</span>. The sender is Roamly.
        </p>
        <button onClick={onClose} className="mt-4 w-full rounded-full gradient-primary py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-95">
          Got it
        </button>
      </Modal>
    );
  }

  return (
    <Modal label={mode === "signup" ? "Create your account" : "Welcome back"} onClose={onClose}
      cardClassName="relative w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-xl">
      <button onClick={onClose} aria-label="Close" className="absolute right-5 top-5 text-muted-foreground"><X size={18} /></button>
      <h3 className="font-display text-xl font-semibold">{mode === "signup" ? "Create your account" : "Welcome back"}</h3>
      <button onClick={withGoogle} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card py-2.5 text-sm font-semibold transition hover:border-primary/40">
        <LogIn size={16} /> Continue with Google
      </button>
      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>
      <div className="space-y-2.5">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
          className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "signup" ? "Password (8+ chars, a letter & a number)" : "Password"}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      {TURNSTILE_SITE_KEY && <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaReset} />}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <button onClick={submit} disabled={loading} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full gradient-primary py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">
        <Mail size={16} /> {mode === "signup" ? "Sign up" : "Sign in"}
      </button>
      <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="mt-3 w-full text-center text-xs text-muted-foreground underline">
        {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
    </Modal>
  );
}

// Shown when someone arrives from an invite (or password-recovery) email
// link: they're already signed in magic-link-style but have no password, so
// this required step ensures they can sign back in later.
export function SetPasswordModal({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!supabase) return null;
  const client = supabase;

  const save = async () => {
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setSaving(true);
    setError(null);
    const { error: err } = await client.auth.updateUser({ password });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onDone();
  };

  return (
    <Modal label="Set a password" onClose={() => {}} backdropClose={false}
      cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-xl">
      <h3 className="font-display text-xl font-semibold">Welcome to Roamly!</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">
        You're signed in. Set a password so you can sign back in next time.
      </p>
      <div className="mt-4 space-y-2.5">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (8+ characters)"
          className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password"
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <button onClick={save} disabled={saving}
        className="mt-4 w-full rounded-full gradient-primary py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">
        {saving ? "Saving…" : "Save password"}
      </button>
    </Modal>
  );
}
