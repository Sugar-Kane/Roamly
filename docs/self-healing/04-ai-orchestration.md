# 04 — AI orchestration

Implementation: `api/selfheal-investigate.ts`.

## Why three stages, not one agent loop

```
stage=investigate   evidence → root cause + confidence     cheap, always runs
stage=reproduce     diagnosis → failing Playwright test    medium, gated
stage=patch         diagnosis + source → diff + PR body    expensive, gated
```

Separate invocations rather than one chained agent, for four reasons:

1. **Serverless wall clock.** A single chain that collects evidence, reasons,
   writes a test, and authors a patch will exceed a function's budget on any
   non-trivial incident.
2. **Each output is a reviewable artifact.** A human can stop at a good
   diagnosis and write the fix themselves. An opaque agent loop offers no such
   exit.
3. **Failure isolation.** A crash in patch authoring must not discard a good
   diagnosis that cost real money to produce.
4. **Model economics.** Diagnosis is high-volume and latency-sensitive; patch
   authoring is rare and quality-critical. Running diagnosis on Haiku and
   patching on Sonnet is the single biggest lever on running cost — roughly a
   3× difference on the dominant term. See [11](11-cost.md).

## Stage 1 — evidence collection and RCA

### What gets collected

Evidence quality determines diagnosis quality more than model choice does. Given
only an error message, any model guesses. Given the failing route, the *unmet
expectation*, the console tail, the network tail, the deploy that preceded it,
and the actual source file, a model usually names the bug precisely.

| Evidence | Source | Why it matters |
|---|---|---|
| Incident events (40) | `sh_events WHERE incident_id` | The failure itself |
| **Lead-up (60)** | Same sessions, before `last_seen_at` | What happened in the 30s *before* is usually more diagnostic than the failure |
| Outcome rows | `sh_outcomes` for the contract | The met/unmet expectation diff |
| Session context | `sh_sessions` | Device, browser, viewport, release, flag state |
| Source files | GitHub contents API | The actual code |
| Recent commits (10) | GitHub commits API | Deploy correlation |
| **Prior resolved incidents** | `sh_learning` by fingerprint or route | Continuous learning |

All of it is persisted to `sh_incident_evidence`, so the dashboard can show
**exactly what the model saw**. An opaque diagnosis is an untrustworthy one.

### Source file access is constrained by construction

`fetchSourceFiles()` reads only paths derived from **our own telemetry** — the
incident's `component` (validated against `^(src|api|supabase)/` and rejected if
it contains `..`) plus a small static route→file map. It never reads a path the
model asked for. Letting model output select file paths would be an
arbitrary-file-read primitive driven by untrusted input.

### The prompt

The system prompt front-loads Roamly's architectural facts, because they are
frequently *the answer*:

- Authorization lives entirely in Postgres RLS; the browser talks to Postgres
  directly. A 401/403/empty-result is almost always a policy, not client code.
- `profiles.is_premium` is written only by the Stripe webhook. Premium bugs are
  webhook or timing bugs.
- Room timers are wall-clock math, not ticks.
- A deploy replaces hashed chunks, so chunk-load errors in an old tab are
  expected and self-heal.

Without these, a model reasonably but wrongly proposes client-side fixes for
server-side authorization bugs — the most common failure mode of naive LLM
debugging on this stack.

### Calibration is the requirement, not confidence

> Be honest about confidence. A calibrated 0.4 is far more useful than an
> overconfident 0.9 — everything downstream gates on this number.

Confidence drives the patch gate (0.55), the alert decision, and the reviewer's
prior. An overconfident model is *worse than no model*, because it converts
reviewer attention into wasted time and erodes trust in the whole platform.
`sh_learning.diagnosis_correct` measures whether calibration holds; see
[12](12-roadmap.md) for the review cadence.

## Stage 2 — reproduction

Capped at **3 attempts**. An unreproducible incident is still a real incident —
it goes to a human with everything learned, rather than burning budget on a
fourth guess.

Each retry receives the previous attempt's failure output, framed correctly:
*your last test failed for the wrong reason (bad selector, missing stub) — fix
that*. Without this framing, retries tend to rewrite the test from scratch and
repeat the same mistake.

Generated code passes `extractCode()`, which **rejects** anything containing
`require(`, `child_process`, `fs.`, or reads of `SUPABASE_SERVICE_ROLE_KEY` /
`STRIPE_*` / `ANTHROPIC_*` / `GITHUB_*`. A "test" is arbitrary code that CI will
execute with repository credentials in scope; treating generated test code as
trusted would be the largest hole in the system.

The bar for a valid reproduction: **it must fail before the fix and pass
after**. A test that passes on the broken build proves nothing and is worse than
no test, because it manufactures false confidence. See
`tests/generated/README.md`.

## Stage 3 — patch authoring

### The confidence gate

```ts
if (Number(diagnosis.confidence) < 0.55) { /* stop, hand to a human */ }
```

A low-confidence diagnosis produces a low-quality patch that costs a reviewer
more time than writing the fix themselves. Not proposing is a valid, and often
the correct, outcome.

### The prompt's hard rules

- **Minimal.** Only what the root cause requires. No refactoring, no renaming,
  no dependency changes. A large diff gets rejected regardless of correctness,
  so a large diff is a wasted call.
- Match surrounding style, naming, and comment density exactly.
- If the correct fix touches a protected surface, **still propose it** — and say
  so plainly. It will be routed to a human, and that is the correct outcome, not
  a failure. A model that avoids proposing protected fixes just hides the real
  cause.
- If not confident the fix is complete, say so rather than padding the diff.

### The model's approval suggestion is advisory only

```ts
const { data: classified } = await admin.rpc("sh_classify_approval", { … });
// stored with approval_level = classified, never the model's suggestion
```

And `sh_enforce_patch_level()` re-runs the classifier in a `BEFORE INSERT OR
UPDATE` trigger, so even this application code cannot be the weak point. The
model's `suggested_level` is recorded in `level_reason` purely for later
comparison — measuring how often the model and the classifier disagree is a
useful early-warning signal. See [05](05-safety-and-approval.md).

## Continuous learning

Every resolved incident writes an `sh_learning` row: root cause, fix, files,
tests, timings, confidence, and **`diagnosis_correct`**. Rejections and
rollbacks write rows too, with `diagnosis_correct = false` — a rejected fix is
training data, not a dead end; it tells the next diagnosis that this class of
fix was wrong here.

Retrieval today is `fingerprint = ? OR route = ?`, limit 5, injected as
`previouslyResolvedSimilarIncidents`. This is intentionally simple: at a corpus
of tens of incidents, exact-match retrieval performs as well as embeddings for a
fraction of the operational cost. The upgrade path (pgvector at ~1,000
incidents) is in [02](02-data-model.md#table-reference).

## Cost controls

| Control | Value | Why |
|---|---|---|
| Incidents per invocation | 5 | An outage generating 1,000 incidents must not spend the month's budget in one sweep |
| Sweep cadence | 15 min | A 14-minute-old incident is not meaningfully worse than a 1-minute-old one; critical incidents alert immediately regardless |
| Diagnosis model | Haiku | High volume, latency-sensitive |
| Patch model | Sonnet | Rare, quality-critical |
| Confidence gate | 0.55 | Skips the expensive stage when it would waste a reviewer's time anyway |
| Repro attempts | 3 | Diminishing returns are steep |
| Prompt size cap | 120KB | Bounds worst-case input tokens |
| Anthropic console spend limit | account-level | The hard backstop behind every in-app control |

Per-call token counts and USD are recorded on every `sh_diagnoses` and
`sh_patches` row, so the cost model in [11](11-cost.md) is measured rather than
projected.

## Failure modes

| Failure | Handling |
|---|---|
| Unparseable JSON | `parseJson()` strips fences and slices to outer braces; still failing → logged, incident unchanged, retried next sweep |
| Model hallucinates a file | The patch references a path that doesn't exist; the GitHub commit step fails; the issue still carries the analysis |
| Model proposes an unsafe change | Classifier escalates to `manual`; a human decides |
| Prompt injection in evidence | Prompts declare evidence untrusted and require reporting attempts; `scrubForPrompt()` strips instruction-shaped text; the DB classifier is the real control |
| Anthropic outage | Stage fails, logged, retried next sweep. Detection and alerting are unaffected — they don't involve a model |
| Runaway retry | Attempt cap + per-invocation cap + cron cadence |
