// Two-step verification (TOTP authenticator apps) on Supabase Auth MFA.
//
// Admin access requires it: public.is_admin() only answers true for a session
// at assurance level aal2, and every admin API route asks is_admin() with the
// caller's own token. Anyone else can turn it on for their account too.
//
//  * TwoFactorSection: the Security block in Account settings. Enroll (QR code
//    plus the secret for manual entry), confirm with a first code, or turn off.
//  * MfaGate: after a password/Google sign-in the session is aal1; if the
//    account has a verified factor it asks for a code before the app continues.
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "./supabaseClient";
import { Modal } from "./Modal";

type Factor = { id: string; status: string; friendly_name?: string };
type Enrolling = { factorId: string; qr: string; secret: string };

const codeOk = (code: string) => /^\d{6}$/.test(code);

function CodeInput({ value, onChange, onSubmit, autoFocus }: { value: string; onChange: (v: string) => void; onSubmit: () => void; autoFocus?: boolean }) {
  return (
    <input value={value} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      onKeyDown={(e) => { if (e.key === "Enter" && codeOk(value)) onSubmit(); }}
      aria-label="6-digit code from your authenticator app" placeholder="123456"
      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
  );
}

async function verifiedFactors(): Promise<Factor[]> {
  if (!supabase) return [];
  const { data } = await supabase.auth.mfa.listFactors();
  return ((data?.totp ?? []) as Factor[]).filter((f) => f.status === "verified");
}

export function TwoFactorSection() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminNeedsIt, setAdminNeedsIt] = useState(false);

  const refresh = useCallback(async () => {
    setFactors(await verifiedFactors());
    if (supabase) {
      const [{ data: member }, { data: admin }] = await Promise.all([supabase.rpc("is_admin_member"), supabase.rpc("is_admin")]);
      setAdminNeedsIt(member === true && admin !== true);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const start = async () => {
    if (!supabase) return;
    setBusy(true); setError(null);
    // An abandoned earlier attempt leaves an unverified factor behind; clear it
    // so the new enrollment isn't refused as a duplicate.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of (list?.all ?? []) as Factor[]) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (err || !data) { setError("Couldn't start setup. Try again in a moment."); return; }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  };

  const confirm = async () => {
    if (!supabase || !enrolling || !codeOk(code)) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.factorId, code });
    setBusy(false);
    if (err) { setError("That code didn't match. Check the time on your phone and try the newest code."); return; }
    setEnrolling(null); setCode("");
    await refresh();
  };

  const turnOff = async (factorId: string) => {
    if (!supabase) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (err) { setError("Turning it off needs a fresh code: sign out, sign back in with your code, then try again."); return; }
    await supabase.auth.refreshSession();
    await refresh();
  };

  const on = (factors?.length ?? 0) > 0;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <ShieldCheck size={16} className={`shrink-0 ${on ? "text-primary" : "text-muted-foreground"}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Two-step verification</span>
          <span className="block text-xs text-muted-foreground">
            {factors === null ? "Checking…" : on ? "On. Sign-ins ask for a code from your authenticator app." : "Ask for a code from an authenticator app when you sign in."}
          </span>
        </span>
        {factors !== null && !enrolling && (on ? (
          <button onClick={() => void turnOff(factors![0].id)} disabled={busy}
            className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-50">Turn off</button>
        ) : (
          <button onClick={() => void start()} disabled={busy}
            className="shrink-0 rounded-full gradient-primary px-3 py-1.5 text-xs font-semibold text-white shadow-glow disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : "Set up"}
          </button>
        ))}
      </div>
      {adminNeedsIt && !enrolling && (
        <p role="status" className="mt-2 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
          {on ? "Admin tools need this session verified: sign out and back in with your code." : "Admin tools are locked until two-step verification is on."}
        </p>
      )}
      {enrolling && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-card/60 p-3">
          <p className="text-xs text-muted-foreground">1. Scan this with an authenticator app (Google Authenticator, 1Password, Authy…).</p>
          <img src={enrolling.qr} alt="QR code for your authenticator app" className="mx-auto h-44 w-44 rounded-lg bg-white p-2" />
          <p className="text-center text-[11px] text-muted-foreground">Can't scan? Enter this key: <span className="select-all break-all font-mono text-foreground">{enrolling.secret}</span></p>
          <p className="text-xs text-muted-foreground">2. Enter the 6-digit code it shows.</p>
          <CodeInput value={code} onChange={setCode} onSubmit={() => void confirm()} autoFocus />
          <div className="flex gap-2">
            <button onClick={() => { setEnrolling(null); setError(null); }} className="flex-1 rounded-full border border-border py-2 text-sm text-muted-foreground">Cancel</button>
            <button onClick={() => void confirm()} disabled={busy || !codeOk(code)} className="flex-1 rounded-full gradient-primary py-2 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? "Checking…" : "Turn on"}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

// Shown over the app while a signed-in session still owes its second step.
export function MfaGate({ accessToken, onSignOut }: { accessToken: string; onSignOut: () => void }) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled || !data || data.currentLevel !== "aal1" || data.nextLevel !== "aal2") { setFactorId(null); return; }
      const factors = await verifiedFactors();
      if (!cancelled) setFactorId(factors[0]?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  if (!factorId) return null;
  const verify = async () => {
    if (!supabase || !codeOk(code)) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (err) { setError("That code didn't match. Try the newest one."); setCode(""); return; }
    setFactorId(null);
  };
  return (
    <Modal label="Two-step verification" onClose={() => {}} backdropClose={false}
      cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
      <div className="grid h-11 w-11 place-items-center rounded-2xl gradient-primary text-white shadow-glow"><KeyRound size={20} /></div>
      <h3 className="mt-4 font-display text-xl font-semibold">Enter your code</h3>
      <p className="mt-1 text-sm text-muted-foreground">Open your authenticator app and enter the 6-digit code for Roamly Flow.</p>
      <div className="mt-4"><CodeInput value={code} onChange={setCode} onSubmit={() => void verify()} autoFocus /></div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={onSignOut} className="flex-1 rounded-full border border-border py-2.5 text-sm text-muted-foreground">Sign out</button>
        <button onClick={() => void verify()} disabled={busy || !codeOk(code)} className="flex-1 rounded-full gradient-primary py-2.5 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? "Checking…" : "Continue"}
        </button>
      </div>
    </Modal>
  );
}
