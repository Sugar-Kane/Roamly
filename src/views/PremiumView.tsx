import { useEffect, useState } from "react";
import { Crown, Plus, Check } from "lucide-react";
import { getAccessToken, type Profile } from "../db";
import { currentUploadPeriod, FREE_MONTHLY_UPLOAD_QUOTA, PREMIUM_MONTHLY_UPLOAD_QUOTA } from "../UploadTasks";
import { ConfirmModal } from "../taskModals";
import type { Session } from "@supabase/supabase-js";

export function PremiumView({ isPremium, session, profile, onSubscribe, checkoutLoading, checkoutError }: {
  isPremium: boolean;
  session: Session | null;
  profile: Profile | null;
  onSubscribe: (choice?: "small" | "large" | "monthly" | "annual") => void;
  checkoutLoading: boolean;
  checkoutError: string | null;
}) {
  // A comped/admin-granted Premium account never went through Stripe checkout,
  // so it has no customer to open the billing portal for. Only offer "Manage
  // subscription" when there's an actual Stripe customer behind the account.
  const hasStripeSubscription = !!profile?.stripe_subscription_id;
  const perks = ["Planned study scheduling", "10 AI note uploads each month", "Breakdowns, achievements & post-mortem", "Full analytics history", "Host up to 3 live study rooms", "Voice chat during room breaks", "PANCE & Marathon methods"];
  const credits = (profile?.ai_credits as number | undefined) ?? 0;
  // [feature, no account, free account, Premium account]. Every theme is free
  // for everyone, so themes intentionally do not appear as a tier difference.
  const compare: [string, string | boolean, string | boolean, string | boolean][] = [
    ["Price", "$0", "$0", "$3 monthly or $30 yearly"],
    ["Tasks", "5 on this device", "Unlimited + synced", "Unlimited + synced"],
    ["Exam schedules", false, "Multiple + synced", "Multiple + synced"],
    ["AI note uploads", false, "3 a month", "10 a month"],
    ["Planned study", false, false, true],
    ["Extra upload credits", false, "Buy anytime", "Buy anytime"],
    ["Timer methods", "Core methods", "Core methods", "+ PANCE Drill & Marathon"],
    ["Study rooms", "Browse only", "Join any room", "Join + host up to 3"],
    ["Room break chat", false, true, true],
    ["Voice chat during breaks", false, false, true],
    ["Analytics", "7-day local basics", "7-day synced basics", "Breakdowns, achievements & full history"],
  ];
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  // In-app cancel: sets Stripe's cancel_at_period_end, so Premium runs through
  // the already-paid period and then lapses. Local state reflects the API
  // response immediately; the webhook + realtime profile refresh make it stick.
  const [pendingCancel, setPendingCancel] = useState<boolean>(!!profile?.premium_cancel_at_period_end);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  useEffect(() => { setPendingCancel(!!profile?.premium_cancel_at_period_end); }, [profile?.premium_cancel_at_period_end]);
  const periodEndText = profile?.premium_expires_at ? new Date(profile.premium_expires_at).toLocaleDateString() : null;

  // Confirming a cancel goes through the app's themed ConfirmModal (matching
  // every other confirmation in the app) rather than a bare window.confirm().
  const [confirmCancel, setConfirmCancel] = useState(false);
  const changeCancel = (resume: boolean) => {
    // Resuming (undoing a pending cancel) is non-destructive — no prompt.
    if (resume) { void runChangeCancel(true); return; }
    setConfirmCancel(true);
  };
  const runChangeCancel = async (resume: boolean) => {
    setCancelBusy(true);
    setCancelError(null);
    try {
      const token = await getAccessToken();
      if (!token) { setCancelBusy(false); return; }
      const res = await fetch("/api/cancel-subscription", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ resume }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setCancelError(data.error ?? "Couldn't update the subscription. Try again."); setCancelBusy(false); return; }
      setPendingCancel(data.cancel_at_period_end === true);
      setCancelBusy(false);
    } catch {
      setCancelError("Couldn't reach the payments server. Try again soon.");
      setCancelBusy(false);
    }
  };

  // Monthly allowance vs purchased credits, mirroring UploadTasks: the
  // allowance resets each month (no rollover); purchased credits never expire.
  const usedThisPeriod = profile?.ai_uploads_period === currentUploadPeriod() ? (profile?.ai_uploads_count ?? 0) : 0;
  const monthlyQuota = isPremium ? PREMIUM_MONTHLY_UPLOAD_QUOTA : FREE_MONTHLY_UPLOAD_QUOTA;
  const monthlyRemaining = Math.max(0, monthlyQuota - usedThisPeriod);

  // Stripe Billing Portal: update card, view invoices, or cancel. Cancelling
  // flows through the webhook, which reverts the account to free automatically.
  const openPortal = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const token = await getAccessToken();
      if (!token) { setPortalLoading(false); return; }
      const res = await fetch("/api/create-portal-session", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setPortalError(data.error ?? "Couldn't open the billing portal. Try again.");
        setPortalLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setPortalError("Couldn't reach the billing portal. Try again soon.");
      setPortalLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      {confirmCancel && (
        <ConfirmModal
          title="Cancel your subscription?"
          body={`Premium stays active until ${periodEndText ?? "the end of the paid period"}, then your account returns to the free tier.`}
          confirmLabel="Cancel subscription"
          onConfirm={() => { void runChangeCancel(false); }}
          onClose={() => setConfirmCancel(false)}
        />
      )}
      <h1 className="font-display text-3xl font-semibold">{isPremium ? "Your Premium" : "Go Premium"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Built for the long road to the PANCE.</p>

      {!isPremium && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-border bg-card/70">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[1.25fr_repeat(3,minmax(0,1fr))] gap-x-3 border-b border-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>What you get</span><span>No account</span><span>Free account</span><span className="text-primary">Premium account</span>
            </div>
            {compare.map(([feature, guest, free, prem]) => (
              <div key={feature} className="grid grid-cols-[1.25fr_repeat(3,minmax(0,1fr))] items-center gap-x-3 border-b border-border/50 px-4 py-2 text-sm last:border-b-0">
                <span className="min-w-0 text-muted-foreground">{feature}</span>
                {[guest, free, prem].map((value, index) => (
                  <span key={index} className={`min-w-0 text-xs ${index === 2 ? "font-medium" : ""}`}>
                    {value === true ? <Check size={15} className="text-roamly-green" /> : value === false ? <span className="text-muted-foreground/50">-</span> : value}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {isPremium && (
        <div className="mt-6 rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-medium"><Crown size={15} className="text-primary" /> Premium is active. Thanks for supporting Roamly.</p>
          {session && (
            <p className="mt-2 rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              AI uploads: <span className="font-medium text-foreground">{monthlyRemaining} of {monthlyQuota}</span> left this month
              {" · "}<span className="font-medium text-foreground">{credits}</span> purchased credit{credits === 1 ? "" : "s"}.
              {" "}Purchased credits never expire. The monthly allowance resets each month and does not roll over.
            </p>
          )}
          {hasStripeSubscription ? (
            <>
              {pendingCancel ? (
                <p className="mt-2 text-xs font-medium text-roamly-coral">
                  Your subscription is set to cancel{periodEndText ? ` and Premium ends on ${periodEndText}` : " at the end of the paid period"}. You keep everything until then.
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Manage billing below: update your card, see invoices, or cancel. If you cancel (or a payment stops), your account automatically returns to the free tier at the end of the paid period.</p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button onClick={openPortal} disabled={portalLoading}
                  className="rounded-full border border-border bg-card px-5 py-2 text-sm font-medium transition hover:border-primary/40 disabled:opacity-60">
                  {portalLoading ? "Opening…" : "Manage subscription"}
                </button>
                {pendingCancel ? (
                  <button onClick={() => changeCancel(true)} disabled={cancelBusy}
                    className="rounded-full gradient-primary px-5 py-2 text-sm font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">
                    {cancelBusy ? "Saving…" : "Keep subscription"}
                  </button>
                ) : (
                  <button onClick={() => changeCancel(false)} disabled={cancelBusy}
                    className="rounded-full border border-destructive/40 px-5 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-60">
                    {cancelBusy ? "Saving…" : "Cancel subscription"}
                  </button>
                )}
              </div>
              {portalError && <p className="mt-2 text-xs text-destructive">{portalError}</p>}
              {cancelError && <p className="mt-2 text-xs text-destructive">{cancelError}</p>}
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Premium comes from an internal account grant.
              {profile?.premium_expires_at ? ` Access lasts through ${new Date(profile.premium_expires_at).toLocaleDateString()}.` : ""}
            </p>
          )}
        </div>
      )}
      {!isPremium && (
        <div className="mt-6 overflow-hidden rounded-3xl gradient-accent p-px shadow-glow">
          <div className="rounded-3xl bg-card/95 p-7 backdrop-blur">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-card/70 p-4">
                <div className="flex items-baseline gap-2"><span className="font-display text-3xl font-bold">$3</span><span className="text-muted-foreground">/ month</span></div>
                <button onClick={() => onSubscribe("monthly")} disabled={checkoutLoading} className="mt-3 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">Choose monthly</button>
              </div>
              <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
                <div className="flex items-baseline gap-2"><span className="font-display text-3xl font-bold">$30</span><span className="text-muted-foreground">/ year</span></div>
                <p className="mt-0.5 text-xs text-primary">Save $6 annually</p>
                <button onClick={() => onSubscribe("annual")} disabled={checkoutLoading} className="mt-3 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">Choose annual</button>
              </div>
            </div>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {perks.map((p) => (
                <div key={p} className="flex items-center gap-2 text-sm">
                  <Check size={16} className="shrink-0 text-roamly-green" /> {p}
                </div>
              ))}
            </div>
            {checkoutError && <p className="mt-2 text-center text-xs text-destructive">{checkoutError}</p>}
            <p className="mt-2 text-center text-xs text-muted-foreground">Secure subscription billing via Stripe. Cancel anytime.</p>
          </div>
        </div>
      )}

      {/* Credit packs — one-time purchases, for subscribers and free users alike. */}
      <div className="mt-6 rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Plus size={15} className="text-primary" /> Upload credits, no subscription needed
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Extra AI note uploads you buy once. They never expire and are used automatically after your monthly allowance
          ({isPremium ? "10 with Premium" : "3 free"}) runs out.
          {session && <span className="font-medium text-foreground"> You have {credits} credit{credits === 1 ? "" : "s"}.</span>}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { id: "small" as const, credits: 2, price: "$1" },
            { id: "large" as const, credits: 5, price: "$2" },
          ].map((p) => (
            <div key={p.id} className="rounded-2xl border border-border bg-card/70 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">{p.credits} uploads</span>
                <span className="font-display text-xl font-bold">{p.price}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Upload credits only. This does not unlock Premium.</p>
              <button onClick={() => onSubscribe(p.id)} disabled={checkoutLoading}
                className="mt-3 w-full rounded-full border border-primary/50 bg-primary/10 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 active:scale-95 disabled:opacity-60">
                {session ? (checkoutLoading ? "Redirecting…" : "Buy with Stripe") : "Sign in to buy"}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">One-time purchase · credits never expire · secure checkout via Stripe.</p>
      </div>
    </div>
  );
}
