import { useRef, useState } from "react";
import { ChevronDown, HelpCircle, MessageSquare } from "lucide-react";
import { Drawer, DrawerSection } from "./Drawer";

// Help & Legal drawer, opened from the site footer. Help rows reuse the
// existing explainer and feedback flows; the legal sections are honest
// plain-language summaries of how the app actually behaves. NOTE: the
// privacy and terms copy below is interim scaffolding written from app
// behavior — swap in reviewed legal text before treating it as policy.

const PRIVACY: [string, string][] = [
  ["What we store", "As a guest, your tasks, sessions, and preferences live only in this browser's local storage — nothing is sent to an account. With an account, your tasks, focus history, exam schedules, and profile are stored with our database provider (Supabase) so they sync across devices."],
  ["Payments", "Subscriptions and credit purchases run entirely through Stripe. Your card details never touch Roamly Flow's servers."],
  ["Email", "Your email address is used for sign-in and account messages only. No marketing lists, no selling data."],
  ["Deleting your data", "Account settings has a Delete account flow that permanently removes your account and everything attached to it. Guest data disappears when you clear this browser's storage."],
];

const TERMS: [string, string][] = [
  ["The service", "Roamly Flow is a study timer and planner. Free accounts get the core experience; Premium adds extra features for a monthly or yearly fee."],
  ["Billing", "Premium renews automatically until cancelled. Cancelling keeps Premium active until the end of the paid period, then the account returns to the free tier. Purchased upload credits are one-time and never expire."],
  ["Fair use", "Study rooms and chat are shared spaces — keep them respectful. Accounts used to abuse the service or other users can be suspended."],
  ["No guarantees", "Roamly Flow is a study aid, not medical or exam advice, and comes without warranties of uptime or fitness for a particular purpose."],
];

function LegalList({ items }: { items: [string, string][] }) {
  return (
    <div className="divide-y divide-border/50 rounded-xl border border-border/60 px-3">
      {items.map(([q, a]) => (
        <details key={q} className="group py-0.5">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            {q}
            <ChevronDown size={14} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <p className="pb-3 text-xs leading-relaxed text-muted-foreground">{a}</p>
        </details>
      ))}
    </div>
  );
}

export function HelpLegal({ onClose, onOpenHowItWorks, onOpenTour, onOpenFeedback }: {
  onClose: () => void;
  onOpenHowItWorks: () => void;
  onOpenTour: () => void;
  onOpenFeedback: () => void;
}) {
  const [tab, setTab] = useState<"help" | "privacy" | "terms">("help");
  const tabs = [["help", "Help"], ["privacy", "Privacy"], ["terms", "Terms"]] as const;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // ARIA tabs keyboard model: Left/Right move between tabs (wrapping), Home/End
  // jump to the ends. Roving tabindex keeps a single tab stop; moving focus also
  // selects, matching the automatic-activation pattern used here.
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    setTab(tabs[next][0]);
    tabRefs.current[next]?.focus();
  };
  return (
    <Drawer label="Help & Legal" onClose={onClose} testId="help-legal">
      <div role="tablist" aria-label="Help and legal sections" className="mb-4 flex gap-1 rounded-full border border-border bg-secondary/40 p-1">
        {tabs.map(([id, name], i) => (
          <button key={id} role="tab" id={`helplegal-tab-${id}`} aria-selected={tab === id}
            aria-controls={`helplegal-panel-${id}`} tabIndex={tab === id ? 0 : -1}
            ref={(el) => { tabRefs.current[i] = el; }}
            onClick={() => setTab(id)} onKeyDown={(e) => onTabKeyDown(e, i)}
            className={`min-h-[36px] flex-1 rounded-full px-3 text-xs font-medium transition ${tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {name}
          </button>
        ))}
      </div>

      {tab === "help" && (
        <div role="tabpanel" id="helplegal-panel-help" aria-labelledby="helplegal-tab-help">
          <DrawerSection title="Get help">
            <button onClick={() => { onClose(); onOpenHowItWorks(); }}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-1 py-2 text-left text-sm transition hover:bg-primary/5">
              <HelpCircle size={16} className="shrink-0 text-muted-foreground" /> How Roamly Flow works
            </button>
            <button onClick={() => { onClose(); onOpenTour(); }}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-1 py-2 text-left text-sm transition hover:bg-primary/5">
              <HelpCircle size={16} className="shrink-0 text-muted-foreground" /> Replay the app tour
            </button>
            <button onClick={() => { onClose(); onOpenFeedback(); }}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-1 py-2 text-left text-sm transition hover:bg-primary/5">
              <MessageSquare size={16} className="shrink-0 text-muted-foreground" /> Contact support / send feedback
            </button>
          </DrawerSection>
          <DrawerSection title="About">
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              Roamly Flow is a focus timer built for PA school: plan what to study, stay on task with
              Pomodoro-style sessions, and watch your progress build toward exam day. The core app is
              free — no account needed to start a timer.
            </p>
          </DrawerSection>
          <DrawerSection title="Accessibility">
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              We're working toward WCAG 2.2 AA. Read our{" "}
              <a href="/accessibility" className="underline underline-offset-2 hover:text-foreground">accessibility statement</a>{" "}
              or report a barrier from the Contact / feedback option above.
            </p>
          </DrawerSection>
        </div>
      )}

      {tab === "privacy" && (
        <div role="tabpanel" id="helplegal-panel-privacy" aria-labelledby="helplegal-tab-privacy">
          <DrawerSection title="Privacy, in plain language">
            <LegalList items={PRIVACY} />
            <p className="mt-3 px-1 text-[11px] text-muted-foreground">Summary of current app behavior — a formal privacy policy is on its way.</p>
          </DrawerSection>
        </div>
      )}

      {tab === "terms" && (
        <div role="tabpanel" id="helplegal-panel-terms" aria-labelledby="helplegal-tab-terms">
          <DrawerSection title="Terms, in plain language">
            <LegalList items={TERMS} />
            <p className="mt-3 px-1 text-[11px] text-muted-foreground">Summary of current app behavior — formal terms of service are on their way.</p>
          </DrawerSection>
        </div>
      )}
    </Drawer>
  );
}
