import { Check, Crown } from "lucide-react";

// One shared card for "this area is Premium" moments. Pages that used to
// stack several small upsell cards render a single one of these instead, so
// free users see one clear pitch per view rather than a wall of locks.
export default function LockedFeaturePreview({ title, description, bullets, cta = "Unlock with Premium", onUpgrade }: {
  title: string;
  description: string;
  bullets?: string[];
  cta?: string;
  onUpgrade: () => void;
}) {
  return (
    <section className="rounded-2xl border border-primary/30 bg-card/80 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="flex items-center gap-1 text-xs font-medium text-primary"><Crown size={12} /> Premium</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {bullets && bullets.length > 0 && (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check size={13} className="mt-0.5 shrink-0 text-roamly-green" /> {b}
            </li>
          ))}
        </ul>
      )}
      <button onClick={onUpgrade} aria-label={`${cta}: ${title}`}
        className="mt-4 min-h-[44px] rounded-full gradient-primary px-5 py-2 text-xs font-semibold text-white shadow-glow transition active:scale-95">
        {cta}
      </button>
    </section>
  );
}
