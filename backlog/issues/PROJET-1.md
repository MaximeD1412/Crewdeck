---
id: PROJET-1
title: "GitHub webhooks: signature in constant time, deliveries deduplicated, dispatched per Pilote, and the 15-minute reconciliation"
epic: PROJET
type: feature
priority: P0
size: M
milestone: M2 Runner and Projets
blocked_by: [CORE-3, CORE-5]
adr: [0002, 0007, 0008]
risques: [SEC-8, OPS-4]
stories: [US-20]
screens: []
revue_visuelle: false
video: false
---

## Context

US-20: a change on GitHub is on screen in under 2 s without reloading. ADR 0002: webhooks go straight to the server (`POST /api/github/webhooks`, `X-Hub-Signature-256` checked in constant time, `X-GitHub-Delivery` deduplicated); a reconciliation reads each followed repository every 15 min and after the server starts. ADR 0008: a webhook or a scheduler job opens the scope of the Pilote it concerns before touching anything. This ticket is the entry point and the plumbing; each module subscribes to the events it needs: the installations and repositories (PROJET-2), issues, PRs and checks (BOUCLE-1), the Inventaire's PR (PROJET-5).

## Current state of the code

- Only documents: `docs/adr/0002-github-app.md` (permissions and events of the App), `docs/adr/0007-real-time.md` (each event carries the time its source saw the change).
- Created by CORE-1: `apps/server/src/errors/`, the logger and its redaction list. CORE-2: `apps/server/src/scope/` (`runInPilotScope`, the global tables allowlist). CORE-3: `apps/server/src/github/` (`GitHubClient`, `installationToken`, `listInstallationRepositories`, `FakeGitHub`, `apps/server/src/config/env.ts`). CORE-5: `apps/server/src/realtime/` (`EventsWriter.write(…, { sourceAt })`).
- No webhook route, no installations index.

## To do

- Environment: `GITHUB_WEBHOOK_SECRET` in `apps/server/src/config/env.ts` and `.env.example`.
- `apps/server/src/github/webhooks/webhooks.controller.ts`: `POST /api/github/webhooks` (`@Public()`), raw body kept for the signature:
  - `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256 of the raw body with the secret, compared with `crypto.timingSafeEqual`; missing or wrong → 401 `github.bad-signature`, nothing parsed;
  - `X-GitHub-Delivery` already seen → 200 `{ duplicate: true }`, nothing dispatched;
  - else 202 at once, then dispatched (an exception in a handler is logged by delivery id and event name, never the payload).
- Prisma model `GitHubDelivery` (`github_deliveries`, global table: `deliveryId` unique, `event`, `receivedAt`), pruned after 7 days by a daily job; added to the global allowlist (CORE-2).
- Prisma model `GitHubInstallation` (`github_installations`, global table, the « App's installations index » of ADR 0008: `installationId` unique, `accountLogin`, `accountId`, `pilotId` nullable, `suspended`, `createdAt`), maintained here from `installation` events: `created` links it to the Pilot whose `githubUserId` is the `sender.id` (none → `pilotId` null, linked at that Pilote's next sign-in by the same rule); `deleted` removes it; `suspend` / `unsuspend` set `suspended`.
- `apps/server/src/github/webhooks/dispatcher.ts`: `GitHubEvents.on(eventName, handler)` for modules; the dispatcher resolves the Pilote from `installation.id` through `github_installations`, opens `runInPilotScope(pilotId)`, and calls each handler with `{ pilotId, installationId, event, action, payload, sourceAt }` (`sourceAt` = the reception time, which `EventsWriter` records for the latency of ADR 0007); an installation with no Pilote: only the `installation` handlers run.
- Payloads stay in memory: a handler reads the metadata it needs (numbers, titles, states, SHAs, labels) and never stores or logs a `body`, a comment or a diff; the logger's redaction test covers a webhook payload.
- `apps/server/src/github/reconciliation/reconciliation.service.ts`: `ReconcileHooks.register({ key, reconcile({ pilotId, installationId }) })`; a job (`@nestjs/schedule`) every 15 min and once 10 s after boot iterates the linked, unsuspended installations, opens each Pilote's scope and calls every hook; a hook's failure is logged and does not stop the others; a run never overlaps the previous one.
- Test fixtures: signed payloads in `apps/server/test/fixtures/webhooks/` (`installation.created.json`, `installation.deleted.json`, `ping.json`) and a helper `signWebhook(body, secret)` in `apps/server/test/fakes/github.ts`.

## Decisions already made

- The server answers 202 before running handlers (GitHub's 10 s timeout); handlers run in the same process, in order of reception per installation.
- `ping` gets 200 and is not stored.
- A delivery is recorded only once its signature is valid, so a forged request cannot fill the table.
- Reconciliation is a hook per module, not a central reader: the module that owns a resource knows what to re-read (BOUCLE-1 issues and PRs, PROJET-2 repositories).

## Acceptance criteria

- [ ] A payload with a valid signature is dispatched to the handlers of its event, in the scope of the installation's Pilote.
- [ ] A wrong or missing signature gives 401 `github.bad-signature`; a test proves the comparison uses `timingSafeEqual`.
- [ ] The same `X-GitHub-Delivery` twice dispatches once.
- [ ] `installation.created` by a known Pilote links the installation; by an unknown GitHub user it is kept and linked at that user's sign-in; `installation.deleted` removes it.
- [ ] The reconciliation runs at boot and every 15 min (fake clock), calls each hook per linked installation, and goes on when one hook throws.
- [ ] Deliveries older than 7 days are pruned; the two global tables are in the allowlist and the walking test passes.
- [ ] No log line of a webhook contains its payload.

## Verification

- `pnpm exec nx test server -- src/github/webhooks/webhooks.controller.spec.ts`
- `pnpm exec nx test server -- src/github/reconciliation/reconciliation.service.spec.ts`
- `pnpm exec nx test-integration server -- webhooks`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`.

## For prod

- `GITHUB_WEBHOOK_SECRET` in the server's `.env` of staging and production, the same as the App's webhook secret (INFRA-11, INFRA-12): one entry in `docs/pilotage/mep.json`.
- The App's webhook URL `https://<domain>/api/github/webhooks` (and staging's): one entry in `docs/pilotage/mep.json`.
- A migration (`github_deliveries`, `github_installations`).

## Out of scope

- The repositories of an installation and the Projets: PROJET-2. Issues, PRs and checks: BOUCLE-1.

## Dependencies

- CORE-3
- CORE-5
