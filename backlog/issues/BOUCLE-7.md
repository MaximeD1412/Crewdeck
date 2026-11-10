---
id: BOUCLE-7
title: "Limit reached, Compte IA disconnected, interrupted Ticket: a Décision that says what to do"
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
---

## Context

US-40: when a **Ticket** stops because a **Compte IA** reached its limit or got disconnected, a **Décision** in « À toi » says what to do: wait for the reset, reconnect, or switch the **Rôle** to another **Moteur** (risk IA-4). The product never switches accounts nor Moteurs by itself to get past a limit (PRD « Out »): a quota is a Décision. A Ticket whose Session was cut (the Runner stopped, the Pilote stopped the Boucle) is « Ticket interrompu » and resumes on « Reprendre » (US-17).

## Current state of the code

- No code in the repository: only the docs and `design/`.
- Created by BOUCLE-3: the Code StepRun and `zLoopStep` (with `interrupted`); BOUCLE-4: the Review StepRun; BOUCLE-2: `loop-scheduler.ts` (it takes resumed `interrupted` Tickets first), the Interrompu card of `/boucle`.
- Created by RUNNER-13: the `usage` of each Compte IA (windows with `resetAt`, per Moteur), the `usage` store slice.
- Created by RUNNER-9: `AgentSession` (`state: interrupted` when the Runner restarted or went offline during it), `POST /api/sessions/:id/resume` (`--resume`), the `session.ended` protocol message. Created by RUNNER-4/5/6: the adapters' normalised limit and sign-in events. Created by RUNNER-7: the Moteurs and models usable and why not (`connexion requise`, `quota atteint`).
- Created by PARAM-3: the Projet's Paramètres (`PATCH /api/projects/:id/settings`, `SettingsService`).
- Created by ATOI-1: `DecisionsService`, `DecisionRow` with its `actions` Emplacement.

## To do

- Protocol (`packages/contracts/src/runner/session.ts`): `session.ended.reason` includes `limit-reached` (with `engine`, `window` such as `5h` or `week`, `resetAt`) and `ai-account-disconnected` (with `engine`); add them if RUNNER-9 did not, mapped from the adapters' normalised events, with a shared fixture valid in TypeScript and Go.
- Server `apps/server/src/loops/interruptions.ts`, on a Code or Review StepRun's Session that ends with:
  - `limit-reached`: `loopStep: interrupted`, `Ticket.interruption = { reason: 'limit-reached', engine, window, resetAt }`; raise `limit-reached` (label « <Compte IA> · fenêtre de 5 h » (the kind « Limite atteinte » is rendered by ATOI-1), meta « <Projet> · #<n> arrêté », subject the Ticket). While it is open, the Boucle of that Projet takes no new Ticket whose Rôle runs on that Moteur.
  - `ai-account-disconnected`: same, reason `ai-account-disconnected`; raise `ai-account-disconnected` (« Compte IA déconnecté · <Compte IA> », context « Reconnecte-le sur ta machine : crewdeck-runner login <moteur> »).
  - an interrupted Session (Runner stopped or offline): `loopStep: interrupted`, reason `runner`; raise `ticket-interrupted` (« Ticket interrompu · #<n> <titre> », meta « <Projet> · Code », context « Le Runner s'est arrêté pendant le Code. »). A stop by the Pilote (BOUCLE-2) raises nothing.
- Commands (`apps/server/src/loops/interruptions.controller.ts`), each `{ seq }`, 422 `ticket.not-interrupted` when the Ticket is not `interrupted`, 409 stale, 404:
  - `POST /api/projects/:id/tickets/:number/resume`: resolves the open Décision of the Ticket (`outcome: resumed`) and marks it resumed; the scheduler takes it first; the StepRun resumes its Session (`POST /api/sessions/:id/resume`), or starts a new one on the same branch when the Session cannot resume.
  - `POST /api/projects/:id/tickets/:number/wait-reset`: keeps the Ticket `interrupted` with `resumeAt = resetAt`; resolves the Décision (`outcome: waiting-reset`); a job (`apps/server/src/loops/resume-job.ts`, every minute, in each Pilote's scope) resumes it at `resumeAt`.
  - `POST /api/projects/:id/tickets/:number/switch-engine` `{ seq, role, engine }`: 422 `ticket.engine-unusable` unless the engine is usable for that Rôle (RUNNER-7); sets the Projet's Paramètres override of that Rôle (its default model) through `SettingsService`, writing its `settings.upserted` event, then resumes as above on the new Moteur. It is the Pilote's explicit choice, never automatic.
- `ai-account-disconnected` resolves itself (`outcome: reconnected`) when the Runner's capabilities report the Moteur usable again, and the Ticket resumes; `limit-reached` resolves itself at `resetAt` when the Pilote answered nothing, and the Ticket resumes.
- Web:
  - In « À toi », the rows' actions (t() keys `aToi.decision.limit.*`, `aToi.decision.interrupted.*`): `limit-reached` context « #<n> reprend à la réinitialisation, à <heure>. Sinon, passe le Rôle <Rôle> sur <Moteur>. », buttons « Attendre <heure> » and « Passer sur <Moteur> » (only when another Moteur is usable for that Rôle); `ai-account-disconnected` a `CodeBlock` of the command and « Passer sur <Moteur> »; `ticket-interrupted` « Reprendre ».
  - On `/boucle`, the « Reprendre » button of each row of the « Interrompu » card (`boucle-arretee`), and the `AgentRow` of an interrupted Ticket « Interrompu · limite de <Compte IA> atteinte » (tone `caution`).
  - `apps/web/src/api/tickets.ts`: `resume`, `waitReset`, `switchEngine`.

## Decisions already made

- The reset hour is shown in the Pilote's time zone (`16:40`); the Décision's label never says a figure the Runner did not report.
- No Ticket is moved to another Moteur without the Pilote's click; the Boucle waits instead.
- An interrupted Review resumes as a new Review on the current head (a review is cheap to redo); an interrupted Code resumes its Session.
- The screens of these rows are those of `a-toi` and `boucle-arretee`, owned by ATOI-1 and BOUCLE-2; this ticket adds their buttons and context, checked by Playwright, without a visual review of its own. « Compte IA déconnecté » has no mockup: it is a `DecisionRow` of tone `caution` like « Limite atteinte ».

## Acceptance criteria

- [ ] A Code Session ending with `limit-reached` (Claude, 5 h, 16:40) interrupts the Ticket and raises « Limite atteinte · Claude · fenêtre de 5 h » with « Attendre 16:40 » and « Passer sur Codex » when Codex is usable; the Boucle of that Projet takes no other Ticket on Claude meanwhile.
- [ ] « Attendre 16:40 » resumes the Ticket at 16:40 (test with a fake clock); doing nothing resumes it at the reset too.
- [ ] « Passer sur Codex » changes only that Projet's Rôle override, then resumes the Ticket on Codex; 422 `ticket.engine-unusable` when Codex is not usable.
- [ ] A Runner restart during a Code Session raises « Ticket interrompu · #47 … »; « Reprendre » resumes its Session, and the Décision is resolved.
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

A migration (columns `tickets.interruption`, `tickets.resume_at`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- Starting the Boucle at a window's reset: BOUCLE-8 (Planification).
- The usage meters themselves: RUNNER-13; the « Comptes IA » card of `/boucle`: BOUCLE-8.
- A spending cap: US-74 (Bêta).

## Dependencies

- BOUCLE-3
- RUNNER-13
