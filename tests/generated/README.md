# Generated reproduction & regression tests

Playwright specs in this directory are **written by the self-healing platform**,
not by hand. Each one corresponds to a row in `sh_repro_attempts` and is named
`incident-<first-8-of-incident-id>.spec.ts`.

## The contract these tests must satisfy

A generated test is only useful if it **fails before the fix and passes after**.
A test that passes on the broken build proves nothing and is worse than no test,
because it manufactures false confidence. The CI job that runs a fresh
reproduction therefore checks it against the *unfixed* build first; a test that
passes there is discarded and the attempt is marked `reproduced: false`.

Once a fix lands, the same file is kept as a permanent regression test — it is
the only thing standing between this bug and its return.

## Rules the generator is held to

- No real credentials, no production URLs, no live backend. The suite runs
  against a preview build with placeholder Supabase vars, so tests stub network
  responses with `page.route()` rather than talking to anything.
- No `child_process`, no filesystem access, no reading privileged env vars.
  `extractCode()` in `api/_selfheal-investigate.ts` rejects generated code
  containing any of these before it is ever stored.
- Deterministic: no arbitrary sleeps, no retry loops.
- Under ~60 lines. A reproduction that needs more than that is a sign the
  diagnosis is not specific enough yet.

## Reviewing one

Treat a generated test exactly like a generated fix: read it. The most common
failure mode is a test that fails for the *wrong reason* (a selector that never
existed), which looks identical to a successful reproduction in the CI summary
but proves nothing about the bug. The `stdout_tail` recorded on each attempt is
there to make that distinction visible.

## Housekeeping

Tests whose incident is `resolved` and which have passed for 90 consecutive days
are candidates for consolidation into the hand-written suites. Nothing deletes
them automatically — pruning regression coverage is a human decision.
