// Break-only advertising surface for NON-premium users (solo + room breaks).
// Shows a small "advertise on Roamly" prompt with a submit form, plus a
// "tired of ads? go Premium" upsell. Submissions land in `ad_submissions` and
// surface in the admin portal (email notification deferred). Advertisers give a
// URL to their creative (TikTok/Reel/video/image), so no file upload is needed.

import { useState } from "react";
import { X, Megaphone, Check, Crown } from "lucide-react";
import { submitAdSubmission, type AdType, type AdPlan } from "./db";
import { track } from "./track";
import { Modal } from "./Modal";

export const AD_PLANS: { id: AdPlan; name: string; price: string; blurb: string }[] = [
  { id: "image_weekly", name: "Image billboard", price: "$19/wk", blurb: "A static image shown on breaks." },
  { id: "short_video_weekly", name: "Short video", price: "$39/wk", blurb: "TikTok / Reel style, up to 15s." },
  { id: "business_video_weekly", name: "Business video", price: "$59/wk", blurb: "Longer promo, up to 60s." },
];

const AD_TYPES: { id: AdType; label: string }[] = [
  { id: "tiktok", label: "TikTok short" },
  { id: "reel", label: "Instagram reel" },
  { id: "business_video", label: "Business video" },
  { id: "image_billboard", label: "Image billboard" },
];

// The break-time card. Renders only when `active` (i.e. on a break, non-premium).
// `onAdvertise` opens the form (the parent decides sign-in vs modal); `onGoPremium`
// routes to the premium upsell.
export function AdBreakPrompt({ active, onAdvertise, onGoPremium }: {
  active: boolean; onAdvertise: () => void; onGoPremium: () => void;
}) {
  if (!active) return null;
  return (
    <div className="w-full rounded-2xl border border-dashed border-border bg-card/70 p-4">
      <div className="flex items-center gap-2">
        <Megaphone size={16} className="text-primary" />
        <h3 className="font-display text-sm font-semibold">Advertise on Roamly</h3>
      </div>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        Reach focused students on their break. Submit a TikTok, reel, business video, or image ad — we review each one.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onAdvertise}
          className="rounded-full gradient-primary px-4 py-1.5 text-xs font-semibold text-white shadow-glow transition active:scale-95">
          Submit an ad
        </button>
        <button onClick={onGoPremium}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
          <Crown size={12} /> Tired of ads? Go Premium
        </button>
      </div>
    </div>
  );
}

export function AdSubmitModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [adType, setAdType] = useState<AdType>("tiktok");
  const [businessName, setBusinessName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [plan, setPlan] = useState<AdPlan>("short_video_weekly");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (businessName.trim().length < 1) { setError("Add your business or name."); return; }
    if (!/^https?:\/\/.+/i.test(targetUrl.trim())) { setError("Add a valid link to your ad (starting with http)."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail.trim())) { setError("Add a valid contact email."); return; }
    setBusy(true);
    setError(null);
    const res = await submitAdSubmission(userId, {
      ad_type: adType,
      business_name: businessName.trim().slice(0, 120),
      target_url: targetUrl.trim().slice(0, 600),
      contact_email: contactEmail.trim().slice(0, 160),
      plan,
      note: note.trim() ? note.trim().slice(0, 1000) : null,
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    track("ad_submitted");
    setDone(true);
  };

  return (
    <Modal label="Advertise on Roamly" onClose={onClose}
      overlayClassName="fixed inset-0 z-[130] grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm"
      cardClassName="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl gradient-primary shadow-glow">
          <Megaphone size={20} className="text-white" />
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X size={18} /></button>
      </div>

      {done ? (
        <div className="mt-4">
          <h3 className="font-display text-xl font-semibold">Thanks — we got it!</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Our team reviews every ad and will reach out at the email you gave us to sort out the details and billing.
          </p>
          <button onClick={onClose} className="mt-5 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95">
            <span className="inline-flex items-center gap-1.5"><Check size={16} /> Done</span>
          </button>
        </div>
      ) : (
        <>
          <h3 className="mt-4 font-display text-xl font-semibold">Advertise on Roamly</h3>
          <p className="mt-1 text-sm text-muted-foreground">Tell us about your ad — we review every submission before it runs.</p>

          <p className="mt-4 text-xs font-medium text-muted-foreground">Ad type</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {AD_TYPES.map((t) => (
              <button key={t.id} onClick={() => setAdType(t.id)} aria-pressed={adType === t.id}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${adType === t.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
                {t.label}
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs font-medium text-muted-foreground">Plan</p>
          <div className="mt-1.5 grid gap-1.5">
            {AD_PLANS.map((p) => (
              <button key={p.id} onClick={() => setPlan(p.id)} aria-pressed={plan === p.id}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${plan === p.id ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:border-primary/40"}`}>
                <span>
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{p.blurb}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-primary">{p.price}</span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Save 15% on a 4-week booking. Billing is arranged after review.</p>

          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Business or your name"
            className="mt-4 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} inputMode="url" placeholder="Link to your video or image (https://…)"
            className="mt-2 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} type="email" placeholder="Contact email"
            className="mt-2 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything else? (optional)"
            className="mt-2 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

          <button onClick={send} disabled={busy}
            className="mt-4 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-50">
            {busy ? "Sending…" : "Submit ad for review"}
          </button>
        </>
      )}
    </Modal>
  );
}
