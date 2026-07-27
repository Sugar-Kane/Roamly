# 08 — Bug Intelligence dashboard

Implementation: `src/adminSelfHealing.tsx`, mounted as the `selfhealing`
section of the existing admin shell (`src/adminDashboard.tsx`).

## The design premise

This page exists to make **one decision fast**: ship this fix, or don't.

Everything else — trends, heat maps, browser distribution, session replay — is
supporting evidence, reachable by drilling in but never in the way. A dashboard
that leads with charts is a dashboard where the pending approval scrolls off
screen, and a patch nobody notices is worse than no patch at all.

The list is therefore sorted so that **anything waiting on a human sorts first**,
before priority score and before recency:

```sql
order by case f.status when 'awaiting_approval' then 0 else 1 end,
         f.priority_score desc, f.last_seen_at desc
```

## Information architecture

```
Bug Intelligence
├─ FilterBar                  shared with the rest of the admin dashboard
├─ KPI row 1                  Open · Critical · Affected users · Awaiting approval
├─ KPI row 2                  MTTD · MTTR · Feature success rate · Journey completion
├─ "N fixes waiting on you"   only when non-empty; the primary call to action
├─ Tabs
│  ├─ Incidents               trend chart · search · status/severity filters · list
│  ├─ Feature health          per-contract success vs floor, p95 latency
│  └─ Flags                   kill switches and rollout percentages
└─ Incident detail (modal)
   ├─ Severity / level / status badges
   ├─ Stats: users · occurrences · route · first seen
   ├─ Level 3 banner          when automation may never deploy this
   ├─ Root cause              + reasoning, confidence, regression risk, model
   │   └─ Alternative hypotheses (collapsed)
   ├─ Reproduction            attempt, reproduced yes/no, test path
   ├─ Proposed fix            summary, explanation, PR link, diff (collapsed)
   ├─ "We've seen this before" prior resolved incidents from sh_learning
   ├─ Audit trail (collapsed) every action, who and when
   └─ Actions                 Investigate · Repro · Propose · Approve · Reject
                              · Roll back · Resolve · Ignore
```

## The four KPIs that matter

**Mean time to detect** is the headline. It answers "how long does a bug live
before we know about it", and it is the number this entire platform exists to
move. Historically that figure is *however long until a user emails us* —
often days, frequently never.

**Mean time to repair** measures the automation loop.

**Feature success rate** is the leading indicator: it falls *before* users
complain, which is the whole thesis.

**Journey completion** is the business metric — checkout completion is revenue.

## Progressive disclosure in the detail modal

The action buttons shown depend on where the incident is in its lifecycle, so
the operator is never presented with a choice that doesn't apply:

| State | Buttons offered |
|---|---|
| No diagnosis | Investigate |
| Diagnosed, no repro | Write repro test |
| Diagnosed, no patch | Propose fix |
| Patch proposed | **Approve** (primary) · Reject |
| Deployed | Roll back |
| Any | Mark resolved · Ignore |

## Making the AI legible

Three deliberate choices, all aimed at the same problem: an operator who cannot
evaluate a diagnosis will either rubber-stamp everything or ignore everything,
and both are failure states.

1. **Confidence is always visible**, on the list row and in the detail. A 62%
   diagnosis reads differently from a 94% one, and it should.
2. **Alternative hypotheses are shown**, with what ruled each one out. A model
   that considered and rejected three explanations is more trustworthy than one
   that asserts a single answer.
3. **"We've seen this before"** surfaces prior resolved incidents. This is the
   continuous-learning loop made visible — it tells the operator the system is
   accumulating knowledge, and it often tells them the answer directly.

## Safety in the UI

The Level 3 banner is unmissable and specific:

> **Level 3.** This touches a protected surface — payments, authentication,
> authorization, RLS, schema, email, or secrets. The platform will never deploy
> it automatically. Review the diff on GitHub and merge by hand.

Note this is a *reflection* of server-side state, not a control. The UI cannot
grant an approval the database won't accept, and pressing Approve on a Level 3
patch opens a draft PR and stops. See [05](05-safety-and-approval.md).

## Flags as a first-class operator tool

The Flags tab leads with the reason it exists:

> Turning a flag off is the fastest remediation available — it reaches every
> user within a minute and needs no deploy.

Auto-disabled flags show their trigger reason inline, so an operator arriving at
a degraded feature immediately sees "auto-rollback: error rate 0.14" rather than
wondering who turned it off.

## Accessibility

The project maintains an accessibility audit (`docs/accessibility/`) and runs
`@axe-core/playwright` in CI, so this page holds the same bar as the rest of the
app:

- Tabs use `role="tablist"` / `aria-selected`.
- Flag toggles are `aria-pressed` buttons, not unlabelled switches.
- The detail modal reuses the shared `Modal`, which provides `role="dialog"`,
  `aria-modal`, focus trapping, focus restoration, and Escape-to-close.
- Every icon is `aria-hidden`; every icon-only control has an accessible name.
- Status is never colour-only — severity and level badges carry text.
- The feature-health table has a `<caption>` and scoped headers.

## Deliberate omissions from Phase 1

Listed here so they are visible as decisions rather than oversights. All are
scheduled in [12](12-roadmap.md).

| Not built | Why |
|---|---|
| Session replay **player** | Traces are captured and stored; the player is a substantial UI build and the trace JSON is readable by an engineer today |
| Heat map / browser distribution | The data is collected (`sh_sessions`); these are visualisations of it, and they don't change the ship/don't-ship decision |
| Assignment to engineers | Single-operator product today; the column exists and the RPC accepts it |
| Real-time push | 60s polling is adequate for a queue measured in minutes; Supabase Realtime on `sh_incidents` is a small change when it isn't |
| Deployment correlation view | `suspected_release` is stored; the correlation UI needs more release data than exists yet to be meaningful |
