---
id: ATOI-3
title: "« Runner hors ligne »: one Décision listing the Projets whose work waits, and the banners"
epic: ATOI
type: feature
priority: P1
size: S
milestone: M2 Runner and Projets
blocked_by: [RUNNER-2, ATOI-1, RUNNER-7]
adr: [0004, 0007]
risques: []
stories: [US-19]
screens: [a-toi-runner-hors-ligne, runner-hors-ligne]
revue_visuelle: true
video: false
---

## Context

US-19: when work waits and the Runner is off, « À toi » shows « Runner hors ligne », one Décision listing the Projets whose work waits, with a notification, so the Pilote never believes agents are working when nothing runs. The glossary's dialogue: « The Boucle waits and « À toi » shows the Décision « Runner hors ligne », with a notification ». The modules that have work for the Runner say so through a registry this ticket creates: the Boucle (BOUCLE-2), the Idée analysis (IDEE-2), the queued StepRuns (RUNNER-12).

## Current state of the code

- Only documents: the mockups `design/screens/crewdeck/a-toi-runner-hors-ligne.html`, `runner-hors-ligne.html`.
- Created by RUNNER-2: `apps/server/src/runners/` (`Runner`, `runner-presence.service.ts` with `isOnline(pilotId)`, `onOnline` / `onOffline` hooks, `lastSeenAt`, the `runner` store slice).
- Created by RUNNER-7: the page `/runner` (Runner card, Moteurs, Comptes IA).
- Created by ATOI-1: `DecisionsService`, the kind `runner-offline`, the kinds views registry and the « À toi » page. Created by UI-3: the Cadre's Runner state and its `banner` Emplacement; UI-2: `Banner`, `CodeBlock`.

## To do

- **Registry** `apps/server/src/runners/waiting-work.ts`: `RunnerWaitingWork.register({ key, projectsWaiting(pilotId): Promise<WaitingProject[]> })` with `WaitingProject = { projectId: zId | null, name: string, items: [{ kind: 'ticket-in-progress' | 'tickets-ready' | 'ticket-interrupted' | 'ideas-waiting' | 'step-queued', number?: int, count?: int }] }` (a `null` Projet is « Idées »); `collect(pilotId)` merges the providers by Projet.
- **Service** `apps/server/src/runners/runner-offline.service.ts`:
  - on `onOffline` (and on `refresh(pilotId)`, which a module calls when new work starts waiting while the Runner is off): `collect`; at least one Projet → `DecisionsService.raise` kind `runner-offline`, `subjectType: 'runner'`, `subjectId` = the Runner's id, tone halt, `label` « Le travail attend dans <n> Projets » (« dans 1 Projet »), `metaParts` « <n> Projets », `params { since: lastSeenAt, projects: JSON string of the WaitingProject list }`, `link` `/runner`; no Projet → nothing (the Cadre still shows « hors ligne »);
  - on `onOnline`: `resolve(…, 'runner-back')`.
- **Page**:
  - `apps/web/src/views/decisions/runner-offline.ts`: meta « <n> Projets · depuis <HH:MM> », context one part per Projet (« Crewdeck : #44 en cours · Personal OS : #53 en cours, 2 Tickets prêts »), action « Voir le Runner » (primary) → `/runner`;
  - the halt `Banner` « Runner hors ligne » in the Cadre's `banner` Emplacement on `/a-toi` while the Décision is open: « Ton Runner ne répond plus depuis <HH:MM>. Le travail attend dans … », « Voir le Runner »;
  - the registry's `needsRunner` actions (ATOI-1) are disabled while the Runner is offline, with « <action> attend que le Runner soit de nouveau en ligne. » as their reason;
  - `/runner` (`apps/web/src/views/runner.ts`): the halt `Banner` « Runner hors ligne » with « Rien ne tourne… » (the waiting Projets when there are, else « Aucun travail n'attend. ») and the `CodeBlock` `crewdeck-runner restart`; the Runner card's badge « hors ligne depuis <HH:MM> ».
- t() keys `runnerOffline.*`, `decision.runnerOffline.*`.
- Scenarios `apps/server/src/testing/scenarios/runner-offline.ts` (`a-toi-runner-hors-ligne`, `runner-hors-ligne`: a Runner offline and a test provider declaring three Projets); Playwright `apps/web/e2e/runner-offline.spec.ts`.

## Decisions already made

- Mockup: `a-toi-runner-hors-ligne`, `runner-hors-ligne` (pages `design/screens/crewdeck/a-toi-runner-hors-ligne.html`, `…/runner-hors-ligne.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The mockup's `crewdeck-runner start` is not a command of ADR 0004: the page shows `crewdeck-runner restart`.
- One Décision per offline period, updated (not duplicated) by `refresh`; the notification is ATOI-4's generic rule on a new Décision, nothing here.
- The usage card's « Dernière mesure à … » is RUNNER-13's; the AgentRow « attend le Runner » is BOUCLE-3's.
- The waiting work is computed from readable state only (ids, numbers, counts).

## Acceptance criteria

- [ ] The Runner goes offline while a provider declares work: one « Runner hors ligne » Décision lists its Projets, in « À toi » with the banner, within 2 s of the 45 s timeout.
- [ ] No provider declares work: no Décision; the Cadre shows the Runner « hors ligne ».
- [ ] `refresh` while offline updates the same Décision with the new Projet.
- [ ] The Runner back online resolves the Décision and removes the banner.
- [ ] While offline, an action marked `needsRunner` on another Décision is disabled with its reason.
- [ ] `/runner` shows the offline banner, the restart command and « hors ligne depuis <HH:MM> »; screens at 390 and 1280 match the mockups, axe without violations.

## Verification

- `pnpm exec nx test server -- src/runners/runner-offline.service.spec.ts`
- `pnpm exec nx test-integration server -- runners`
- `pnpm exec nx test web -- src/views/decisions/runner-offline.spec.ts`
- `pnpm exec nx e2e web -- runner-offline.spec.ts`; `scripts/captures.sh apps/web/e2e/runner-offline.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`.

## For prod

Nothing.

## Out of scope

- The providers of each module: BOUCLE-2, IDEE-2, RUNNER-12. The push: ATOI-4. Interrupting the Sessions: SESSION-2.

## Dependencies

- RUNNER-2
- ATOI-1
- RUNNER-7
