---
id: INFRA-9
title: "nightly.yml (full scope on develop at 03:30 UTC) and actions-minutes.yml (fails at 80 % of the month's quota)"
epic: INFRA
type: chore
priority: P2
size: S
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-3]
adr: [0009]
risques: [OPS-6, AGT-2]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

PRs run only what they affect (INFRA-3); the nightly runs everything on `develop`, and « a red nightly is fixed before anything else » (AGENTS.md « Checking »). Agents open many PRs: the Actions minutes are watched daily, not discovered on the bill (ADR 0009, « CI »; risk OPS-6).

## Current state of the code

- Created by INFRA-3: `.github/workflows/verify.yml` (`workflow_call`, input `scope`: `affected` | `full`) and `ci.yml`.
- No `nightly.yml`, no `actions-minutes.yml`, no `.github/scripts/`.

## To do

- **`.github/workflows/nightly.yml`**: `on: schedule` `cron: '30 3 * * *'` and `workflow_dispatch`; checks out `develop`; calls `verify.yml` with `scope: full`. The compiled Runner's smoke test is added to this workflow by RUNNER-14 as its own job.
- **`.github/workflows/actions-minutes.yml`**: `cron: '17 6 * * *'` and `workflow_dispatch`; runs `node .github/scripts/actions-minutes.mjs` with `ACTIONS_BILLING_TOKEN` (secret: fine-grained token of the account, « Plan » read) and `ACTIONS_MINUTES_QUOTA` (variable, default 3000).
- **`.github/scripts/actions-minutes.mjs`**: reads the month's usage from the billing API (`GET /users/{owner}/settings/billing/usage`, Actions minutes of the current month), computes the projection at the month's end (`used / elapsed days × days in month`), prints both and the quota, exits 1 with « 80 % du quota atteint » when `used ≥ 0.8 × quota`, or « projection au-delà du quota » when the projection exceeds it; exits 0 with a notice when the token is missing. Pure functions `usage(used, quota, now)` exported for the test.
- **Test** `.github/scripts/actions-minutes.spec.mjs` (Node's test runner, `node --test`): 2 400 of 3 000 fails, 1 000 on the 10th of a 30-day month passes, 1 200 on the 10th fails on the projection.
- `docs/ci.md` (created by INFRA-3): add the two workflows.

## Decisions already made

- Personal-os's `actions-minutes.yml` and its script (repository `MaximeD1412/personal-os`) are the model.
- A red nightly is reported by GitHub's email of the failed workflow; no other channel.

## Acceptance criteria

- [ ] `nightly.yml` runs `verify.yml` in full scope on `develop` at 03:30 UTC and from a manual dispatch.
- [ ] `actions-minutes.mjs` fails at 80 % of the quota and when the month's projection exceeds it, passes otherwise (spec).
- [ ] Without `ACTIONS_BILLING_TOKEN`, `actions-minutes.yml` passes with a notice.

## Verification

- `node --test .github/scripts/actions-minutes.spec.mjs`
- `actionlint .github/workflows/nightly.yml .github/workflows/actions-minutes.yml`

## For prod

In `docs/pilotage/mep.json`: the secret `ACTIONS_BILLING_TOKEN` and the variable `ACTIONS_MINUTES_QUOTA` (Settings > Secrets and variables > Actions), set by the founder.

## Out of scope

- The Runner's smoke test in the nightly: RUNNER-14.

## Dependencies

- INFRA-3.
