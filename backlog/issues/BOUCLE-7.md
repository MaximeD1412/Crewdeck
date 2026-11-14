---
id: BOUCLE-7
title: "Limit reached, Compte IA disconnected, interrupted Ticket: a Décision that says what to do, and « Reprendre »"
epic: BOUCLE
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-3, RUNNER-13]
adr: [0004, 0007, 0008]
risques: [IA-4]
stories: [US-40, US-17]
screens: []
revue_visuelle: false
video: false
reprend: 88
---

## Context

US-40: when a **Ticket** stops because a **Compte IA** reached its limit or got disconnected, a **Décision** in « À toi » says what to do: wait for the reset, reconnect, or switch the **Rôle** to another **Moteur** (risk IA-4). The product never switches accounts nor Moteurs by itself to get past a limit (PRD « Out »): a quota is a Décision. A Ticket whose **Session** was cut (the Runner stopped, the Pilote stopped the **Boucle**) is « Ticket interrompu » and resumes on « Reprendre » (US-17). Since the refonte, a Ticket's work is a PhaseRun of the Projet's « pour chaque Ticket prêt » **Phase** (BOUCLE-2), whose agent **Étapes** are whatever its pinned **Process** version holds (Code, Review, a second Review on another Rôle…): the interruption is read on the StepRun whose Session ended, whatever its kind, on a GitHub Projet as on a Local one.

## Current state of the code

- `packages/contracts/src/api/decisions.ts`: `limit-reached`, `ai-account-disconnected`, `ticket-interrupted` in `DECISION_KINDS`; `apps/server/src/decisions/decisions.service.ts`: `raise`, `resolve` (one open per `(kind, subjectId)`). `apps/server/src/ai-accounts/` and `packages/contracts/src/api/ai-accounts.ts`: the Comptes IA reported by the Runner's capabilities.
- `packages/contracts/src/runner/events.ts`: the adapters' normalised events; `apps/runner/internal/engine/` (Claude adapter `claude/claude.go`).
- Created by BOUCLE-3: the `code` handler (modes, rerun on the same branch); BOUCLE-4: the `review` handler; BOUCLE-2: `LoopRecord` (`interruptedAt`, `queuedAt`), the slot, `loop-scheduler.ts`, the « Interrompu » card of `/boucle`, the StepRun state `interrupted`.
- Created by PROCESS-4: `step_runs` (`sessionId`, `state`), the rerun of an Étape in its PhaseRun.
- Created by RUNNER-13: the usage of each Compte IA (windows with `resetAt`, per Moteur), the `usage` slice. Created by RUNNER-9: `AgentSession` (`state: interrupted` after a Runner restart or offline), `POST /api/sessions/:id/resume` (`--resume`), the `session.ended` message. Created by RUNNER-4/5/6: the adapters' normalised limit and sign-in events. Created by RUNNER-7: the Moteurs and models usable, and why not.
- Created by PARAM-3: the Projet's Paramètres (`PATCH /api/projects/:id/settings`, `SettingsService`, a Rôle's override). Created by ATOI-1: `DecisionRow` with its `actions` Emplacement.

## To do

- Protocol (`packages/contracts/src/runner/session.ts`): `session.ended.reason` includes `limit-reached` (`engine`, `window` such as `5h` or `week`, `resetAt`) and `ai-account-disconnected` (`engine`); add them if RUNNER-9 did not, mapped from the adapters' normalised events, with a shared fixture valid in TypeScript and Go.
- Prisma on `LoopRecord`: `interruption` (jsonb `{ reason: 'limit-reached' | 'ai-account-disconnected' | 'runner' | 'pilot', engine?, window?, resetAt?, stepRunId }`), `resumeAt?`. One migration.
- Server `apps/server/src/loops/interruptions.ts`, on an agent StepRun of a `ticket.ready` PhaseRun whose Session ends with:
  - `limit-reached`: StepRun `interrupted`, PhaseRun `waiting`, `LoopRecord.interruptedAt` and `interruption`; raise `limit-reached` (label « <Compte IA> · fenêtre de 5 h », `metaParts` [« #<n> arrêté », the Étape's name], subject the Ticket, `params { engine, window, resetAt, role }`). While it is open, BOUCLE-2's tick admits no new Ticket in that Projet when an agent Étape of the Phase has a Rôle on that Moteur.
  - `ai-account-disconnected`: the same, raise `ai-account-disconnected` (« Compte IA déconnecté · <Compte IA> », context « Reconnecte-le sur ta machine : crewdeck-runner login <moteur> »).
  - an interrupted Session (Runner stopped or offline): reason `runner`; raise `ticket-interrupted` (« Ticket interrompu · #<n> <titre> » on GitHub, « #<n> » on Local, the page completing the title; `metaParts` [the Étape's name]; context « Le Runner s'est arrêté pendant <Étape>. »). BOUCLE-2's stop by the Pilote (reason `pilot`) raises nothing.
- Commands `apps/server/src/loops/interruptions.controller.ts`, each `{ seq }`; 422 `ticket.not-interrupted` when the Ticket's LoopRecord has no `interruptedAt` with a `waiting` PhaseRun; 409 stale; 404 `ticket.not-found`; French messages in `apps/server/src/errors/messages.ts`:
  - `POST /api/projects/:id/tickets/:number/resume`: resolves the Ticket's open Décision of these kinds (`outcome: resumed`), sets `queuedAt` (the slot's first); the interrupted StepRun resumes its Session (`SessionsService.resume`); an Étape that judges, or a Session that cannot resume, gets a new StepRun of the same Étape on the current head (same iteration, PROCESS-4's rerun).
  - `POST /api/projects/:id/tickets/:number/wait-reset`: `resumeAt = resetAt`, the Décision resolved (`outcome: waiting-reset`); `apps/server/src/loops/resume-job.ts` (every minute, `@nestjs/schedule`, in each Pilote's scope) resumes it at `resumeAt`.
  - `POST /api/projects/:id/tickets/:number/switch-engine` `{ seq, role, engine }`: 422 `ticket.engine-unusable` unless that Moteur is usable for the Rôle (RUNNER-7); sets the Projet's override of that Rôle (the Moteur's default model) through `SettingsService`, writing `settings.upserted`, then resumes as above on the new Moteur. The Pilote's explicit choice, never automatic.
- `ai-account-disconnected` resolves itself (`outcome: reconnected`) when the Runner's capabilities report the Moteur usable again, and the Ticket resumes; `limit-reached` resolves itself at `resetAt` when the Pilote answered nothing, and the Ticket resumes.
- Web:
  - In « À toi », the rows' actions (t() keys `aToi.decision.limit.*`, `aToi.decision.interrupted.*`): `limit-reached` context « #<n> reprend à la réinitialisation, à <heure>. Sinon, passe le Rôle <Rôle> sur <Moteur>. », buttons « Attendre <heure> » and « Passer sur <Moteur> » (only when another Moteur is usable for that Rôle); `ai-account-disconnected` a `CodeBlock` of the command and « Passer sur <Moteur> »; `ticket-interrupted` « Reprendre ».
  - On `/boucle`, « Reprendre » on each row of the « Interrompu » card, and the `AgentRow` of an interrupted Ticket « Interrompu · limite de <Compte IA> atteinte » (tone `caution`).
  - `apps/web/src/api/tickets.ts`: `resume`, `waitReset`, `switchEngine`.

## Decisions already made

- The reset hour is shown in the Pilote's time zone (`16:40`); the Décision never says a figure the Runner did not report.
- No Ticket is moved to another Moteur without the Pilote's click; the Boucle waits instead.
- A Rôle's Moteur is a Paramètre of the Projet, not part of a Process version: « Passer sur Codex » applies at once, also to the pinned PhaseRun, and to every Étape of that Rôle in the Projet.
- An interrupted Étape that judges restarts as a new pass on the current head (a review is cheap to redo); any other agent Étape resumes its Session.
- These rows live on the « À toi » page (ATOI-1) and the « Interrompu » card of `/boucle` (BOUCLE-2): this ticket adds their buttons and context, checked by Playwright, without a visual review of its own. « Compte IA déconnecté » is a `DecisionRow` of tone `caution` like « Limite atteinte ».

## Acceptance criteria

- [ ] A Code Session ending with `limit-reached` (Claude, 5 h, 16:40) interrupts the Ticket and raises « Limite atteinte · Claude · fenêtre de 5 h » with « Attendre 16:40 » and « Passer sur Codex » when Codex is usable; the Boucle of that Projet admits no other Ticket while its Phase has an agent Étape on Claude.
- [ ] The same limit during a Review Étape raises the same Décision naming « Review »; « Reprendre » starts a new Review on the current head.
- [ ] « Attendre 16:40 » resumes the Ticket at 16:40 (test with a fake clock); doing nothing resumes it at the reset too.
- [ ] « Passer sur Codex » changes only that Projet's Rôle override, then resumes the Ticket on Codex; 422 `ticket.engine-unusable` when Codex is not usable.
- [ ] A Runner restart during a Code Session on a Local Projet raises « Ticket interrompu · #47 »; « Reprendre » resumes its Session and resolves the Décision.
- [ ] A reconnected Compte IA resolves « Compte IA déconnecté » and the Ticket resumes.
- [ ] Routes: 422 `ticket.not-interrupted`, 409 stale `seq`, 404 for another Pilote's Ticket, 401, 400 with `fields`; each change writes its event in the same transaction.
- [ ] Playwright: the rows of « À toi » and the « Reprendre » of `/boucle` show and act, at 390 and 1280 px, axe without violations.

## Verification

- `pnpm exec nx test server -- src/loops/interruptions.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- loops`
- `pnpm exec nx test contracts`, `cd apps/runner && go test ./internal/protocol/`
- `pnpm exec nx e2e web -- a-toi.spec.ts`, `pnpm exec nx e2e web -- boucle.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

A migration (columns `loop_records.interruption`, `loop_records.resume_at`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- Starting the Boucle at a window's reset: BOUCLE-8 (Planification).
- The usage meters themselves: RUNNER-13; the « Comptes IA » card of `/boucle`: BOUCLE-8.
- A Commande that fails or times out: PROCESS-12. An Étape of another Phase that fails: ATOI-2.
- A spending cap (Bêta).

## Dependencies

- BOUCLE-3
- RUNNER-13
