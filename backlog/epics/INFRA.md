---
id: EPIC-INFRA
title: "[EPIC] INFRA: monorepo, worktrees, CI, captures, image, staging and pushed CD, VPS, backups"
labels: [epic:infra]
---

What lets agents work on Crewdeck and ship it: the Nx monorepo walking skeleton (ADR 0001), `scripts/worktree.sh` and `scripts/captures.sh`, the CI and nightly workflows, the server image with the web build and the Runner binaries, the two Compose projects behind Caddy on one OVH VPS, the pushed CD (staging on `develop`, production promoting staging's image), idempotent provisioning and restic backups (ADR 0009), and the human gestures they need (`type: externe`).

Milestone: M0 Skeleton and delivery. No user story of its own: it carries the MVP's « Done when » (the founder's use) and the risks OPS-2, OPS-3, OPS-6, AGT-2.

Order: INFRA-1 → INFRA-2, INFRA-3, INFRA-4, INFRA-5 → INFRA-6, INFRA-7, INFRA-8 → INFRA-10 → INFRA-12, INFRA-13.
