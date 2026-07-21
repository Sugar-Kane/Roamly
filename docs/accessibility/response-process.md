# Internal Accessibility Response Procedure

**Last updated:** 2026-07-21
**Owner:** Engineering lead (accessibility DRI). Reassign here if ownership changes.

This is the internal companion to the public accessibility statement
(`/accessibility`). It defines how Roamly Flow logs, triages, fixes, and
responds to accessibility barriers, and how we preserve evidence of testing.

## 1. Intake channels

Reports can arrive via:
- Email: `support@roamlyflow.com` (monitored inbox).
- In-app **Help & Legal → Contact support / send feedback** (routes to the feedback flow / GitHub issue).
- Internal discovery (QA, automated CI failures, team members).

## 2. Logging a report

Every barrier becomes a tracked issue with the label **`accessibility`**. Record:
- Date received and reporter contact (if provided).
- Affected page/route and workflow.
- Device, OS, browser, and assistive technology reported.
- Expected vs. actual behavior; steps to reproduce.
- WCAG success criterion (best guess; refine during triage).
- Screenshot / recording if supplied.

## 3. Triage & prioritization (within 5 business days)

Assign a single **owner** and a severity:

| Severity | Definition | Target response | Target fix |
|----------|-----------|-----------------|------------|
| **Critical** | Blocks an essential task (sign in, pay, cancel, start a timer, submit a form) for a group of users. | Acknowledge ≤2 business days | Fix / workaround ASAP, days |
| **High** | Major workflow significantly harder but not fully blocked. | ≤5 business days | Next release cycle |
| **Medium** | Noticeable barrier with a reasonable workaround. | ≤5 business days | Backlog, scheduled |
| **Low** | Minor / cosmetic. | ≤5 business days | Backlog |

## 4. Acknowledgement to the reporter

Within **5 business days**, send a plain-language acknowledgement: we received it,
the severity, and the plan/next step. Provide a workaround if one exists. Keep the
reporter updated on material changes.

## 5. Remediation

- Reproduce, ideally add/extend an automated check (`tests/a11y.spec.ts` or `tests/smoke.spec.ts`).
- Fix in code; verify with keyboard + the relevant screen reader.
- Note the WCAG SC and the verification method in the PR and in `remediation-log.md`.
- Palette/visual-identity changes require design approval before merge (project rule 9).

## 6. Evidence preservation

Keep, per fix:
- The tracked issue with severity, owner, and dates.
- The PR/diff and any new automated test.
- Manual test records (see `manual-qa-plan.md`): AT, browser, OS, route, result, retest.
- CI artifacts (Playwright report, `a11y-contrast-report.jsonl`).

This paper trail is both good practice and useful evidence of a good-faith,
ongoing remediation program should a complaint arise.

## 7. Recurring cadence

- **Every PR/CI run:** automated axe + smoke suites.
- **Each release:** keyboard smoke pass of critical journeys; review new/changed UI against this checklist.
- **Quarterly:** manual VoiceOver + NVDA pass of the journeys in `manual-qa-plan.md`; refresh the audit and statement "last updated" dates.
- **Annually:** consider an external accessibility audit before making any public conformance claim.
