# 10 — Operations

## Initial setup

Every component degrades to a no-op when unconfigured, so these steps can be
done in any order and a partial rollout is safe.

1. **Apply the migration.** Run
   `supabase/migrations/20260727120000_self_healing_platform.sql` in the SQL
   editor. Idempotent; creates no policies on existing tables and modifies no
   existing table, so it cannot affect the running app.
2. **Create the Storage bucket** `selfheal-replays` — **private**, no public
   access, no client policies. Only the service role writes to it.
3. **Set environment variables** in Vercel:
   - `TELEMETRY_IP_SALT` — any long random string. Rotating it breaks
     historical IP correlation, which is acceptable and occasionally desirable.
   - `CRON_SECRET` — for the sweep workflow.
   - `GITHUB_REPO` — defaults to `Sugar-Kane/Roamly`.
   - `GITHUB_BASE_BRANCH` — defaults to `main`.
   - `VITE_RELEASE` — set to the deploy SHA
     (`VITE_RELEASE=$VERCEL_GIT_COMMIT_SHA`). **Do this one.** Without it the AI
     cannot correlate an incident to a deploy, which is the single
     highest-value correlation available.
4. **Set repository secrets** for Actions: `APP_URL`, `CRON_SECRET`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
5. **Verify.** Load the app, then check `select count(*) from sh_sessions`. Open
   Admin → Bug Intelligence.

## Rollout plan

Rolled out behind its own flags, so each phase can be reversed in seconds.

| Phase | Duration | Enable | Exit criterion |
|---|---|---|---|
| 0 — Shadow | 1 week | Telemetry on, replay **off**, no alerts, no AI | Ingest stable; no measurable effect on Core Web Vitals; incident volume is plausible |
| 1 — Detection | 1 week | Contract + journey sweeps; dashboard visible | False-positive rate under review; thresholds tuned against real traffic |
| 2 — Diagnosis | 2 weeks | AI investigation, **no patching** | `diagnosis_correct` ≥ 70% on a manual sample of 20 |
| 3 — Reproduction | 1 week | Repro authoring | Generated tests fail-before/pass-after at a usable rate |
| 4 — Patch proposal | 2 weeks | Patch stage, everything opens a **draft** PR | Acceptance rate ≥ 50%; zero Level-3 misclassifications |
| 5 — Level 1 auto | ongoing | `selfheal.auto_deploy` | Reviewed monthly |

**Phase 0 matters most.** A week of collecting without acting is what tells you
whether the thresholds in [03](03-detection.md) are right for *your* traffic
rather than right in principle. Skipping it means starting Phase 1 with alert
fatigue already established, and an operator who has learned to ignore the
dashboard in week one will not start reading it in week four.

Replay stays off through Phase 0 so that a privacy review can happen against
real captured traces before any are stored.

## Rollback

Ordered fastest to slowest. Reach for the top of the list first.

| Scope | Action | Time |
|---|---|---|
| Stop all telemetry | `sh_flags.selfheal.telemetry` → false | <60s, no deploy |
| Stop replay only | `selfheal.replay` → false | <60s |
| Stop auto-deploy | `selfheal.auto_deploy` → false | <60s |
| Stop AI spend | Disable the `selfheal-sweep` workflow | immediate |
| Revert a deployed patch | Dashboard → Roll back, then revert the merge on GitHub | ~10 min |
| Disable a broken product feature | Its flag → false | <60s |
| Remove the platform entirely | Revert the PR; the migration's tables are additive and can be left in place | one deploy |

The master kill switch is checked in `initSelfHealing()` *after* `initFlags()`
loads the cached snapshot, so it applies from the previous page load's cache —
it does not require a successful network call to take effect.

## Deployment

Unchanged from the existing model: merge to `main` → Vercel builds and deploys.
This work adds:

- `.github/workflows/self-healing.yml` — the verification gauntlet on any PR
  labelled `self-healing`: safety gate, lint, type-check, build, full Playwright
  run, accessibility check, dependency-change rejection, secret scan, and a
  status write-back so the dashboard stops showing `ci_running` forever.
- `.github/workflows/selfheal-sweep.yml` — 15-minute investigation sweep.

Machine-authored PRs get **more** scrutiny than human ones, not less.

## Monitoring the monitor

| Metric | Where | Healthy |
|---|---|---|
| Ingest success rate | Vercel logs, `route: telemetry` | >99% |
| Ingest p95 latency | Vercel | <300ms |
| Events/day | `select count(*) from sh_events where ts > now() - interval '1 day'` | Within 3× of the model in [06](06-scalability.md) |
| Incidents/day | Dashboard | Below the tier table; a spike means a real outage or a bad threshold |
| False-positive rate | `ignored` ÷ total resolved | <20% |
| Diagnosis accuracy | `sh_learning.diagnosis_correct` | >70% |
| Patch acceptance | approved ÷ proposed | >50% |
| AI spend | `sum(cost_usd)` across diagnoses + patches | Under budget ([11](11-cost.md)) |
| Sweep freshness | `max(created_at)` on `sh_diagnoses` | Within 30 min of the newest open incident |

Alerting on the platform's own health is deliberately **not** automated in
Phase 1: it would be the first thing to false-positive, and reviewing these
numbers weekly is sufficient at current scale.

## Runbooks

### "The dashboard shows hundreds of incidents"
Almost always a threshold, not an outage. Check whether they share a
fingerprint prefix or route. If one detector dominates, raise its threshold in
`sensors.ts` or the contract's `min_success_rate` in the DB (no deploy needed
for the latter). Bulk-ignore the noise; do not let it train the operator to
ignore the page.

### "AI spend is climbing"
Check `select sum(cost_usd), model from sh_diagnoses where created_at > now() -
interval '1 day' group by model`. Most likely cause is many distinct
fingerprints from one root cause — improve `sh_normalise()` so they collapse.
Immediate mitigation: disable the sweep workflow.

### "A generated patch broke production"
1. Flag off the affected feature (<60s).
2. Dashboard → Roll back — writes `sh_learning` with
   `diagnosis_correct = false`, which feeds future diagnoses.
3. Revert the merge on GitHub.
4. Ask why CI passed. A generated patch that breaks production *and* passes the
   gauntlet is a **test coverage** incident, not an AI incident, and the fix is a
   test.

### "Telemetry stopped arriving"
Check `/api/health` for env presence, then Vercel logs for `route: telemetry`.
Remember the SDK backs off to 5 minutes after 3 consecutive failures, so
recovery takes a few minutes after the cause is fixed. Confirm
`sh_flags.selfheal.telemetry` is still enabled — an auto-rollback could have
disabled it.

### "An admin can see another user's study content in an incident"
Treat as a **privacy incident**, not a bug. Disable telemetry immediately, find
which layer failed ([09](09-security-and-privacy.md)), purge affected rows,
patch the layer, add a test to `tests/selfheal.spec.ts` that reproduces the
leak, then re-enable.

## Disaster recovery

| Scenario | RPO | RTO | Recovery |
|---|---|---|---|
| Supabase outage | 0 (telemetry loss only) | Provider | App is unaffected; SDK queues and backs off, dropping the oldest low-severity events |
| Database corruption | 24h (PITR on Pro) | ~1h | Point-in-time restore. Telemetry loss is acceptable; `sh_audit_log` and `sh_learning` are the tables worth caring about |
| Storage bucket loss | 30d of replays | n/a | Replays are debugging aids, not records of value. **No recovery attempted** |
| Vercel outage | n/a | Provider | Telemetry is dropped client-side; nothing corrupts |
| Anthropic outage | n/a | Provider | Detection, alerting, and the dashboard are unaffected — none of them involve a model. Investigation resumes on the next sweep |
| GitHub outage | n/a | Provider | Diagnosis continues; PR creation fails and retries |
| Compromised service-role key | — | ~15 min | Rotate in Supabase and Vercel. Review `sh_audit_log` for unexpected actors — this is exactly what it is for |
| Lost `TELEMETRY_IP_SALT` | Historical IP correlation | 0 | Set a new one. No user-facing impact; abuse correlation restarts |

**What is genuinely irreplaceable:** `sh_learning` and `sh_audit_log`. Both are
small, both are included in standard Supabase backups, and both should be
verified present after any restore. Raw telemetry is regenerated by users simply
continuing to use the app; institutional memory and the compliance record are
not.
