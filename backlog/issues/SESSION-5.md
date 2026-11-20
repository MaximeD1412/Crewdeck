---
id: SESSION-5
title: "« Continuer dans mon terminal »: the Session handed off, the command copied, the work « repris hors Crewdeck » and its Décision"
epic: SESSION
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [RUNNER-22, BOUCLE-2, BOUCLE-5]
adr: [0003, 0004, 0007, 0008, 0011]
risques: [SEC-11]
stories: [US-113]
screens: [session, session-terminal]
revue_visuelle: true
video: false
---

## Context

US-113: on any Session the Pilote can choose « Continuer dans mon terminal »: the Session stops, the command that resumes it in its worktree, on the Runner's machine (named), is copied, and the Ticket or the Étape is « repris hors Crewdeck » (never taken back by the Boucle, its dependents waiting) with a **Décision** staying in « À toi » until the Pilote gives the work back (SESSION-6). This ticket is the server's hand-off, the Process's waiting, the Boucle's mark, the Décision and the panel of the Session (the action row, the command, the banner). RUNNER-22 is the Runner's half; SESSION-6 the two ways to give it back.

## Current state of the code

- `packages/contracts/src/api/sessions.ts`: `zAgentSession`, `SESSION_INTERRUPTED_REASONS`, `zSessionAction` (`withSeq({})`) for `POST /api/sessions/:id/stop` and `/resume`. `packages/contracts/src/runner/session.ts`: `SESSION_STATES`, `LIVE_SESSION_STATES` (`starting`, `active`, `waiting`), `RESUMABLE_SESSION_STATES` (`stopped`, `interrupted`). `apps/server/prisma/schema.prisma`: `enum AgentSessionState` (`starting`, `active`, `waiting`, `stopped`, `interrupted`, `ended`), `model AgentSession` (`stepRunId`, `engineSessionId`, `lastSeq`, no worktree path).
- `apps/server/src/sessions/sessions.service.ts`: `stop` and `resume` (`serial` per Pilote, `fresh` 404 `sessions.not-found` / 409 `realtime.stale`, `change` writes `agent-session.upserted` and calls `SessionHooks.changed`, `trySend` to the Runner when online, 422 `runner.offline` on `resume`), `report` (the Runner's `session.state`: only a live Session takes the reported state, `ended` is always taken), `reconnected` (the `hello`'s Sessions: only `LIVE` ones are interrupted). `sessions.controller.ts` routes; `requests.ts` the question and permission Décisions (`resolveOpenRequests`); French messages in `apps/server/src/errors/messages.ts` (`sessions.not-running`, `sessions.not-resumable`).
- `apps/server/src/process/engine/kinds/agent.ts` `onSession`: `active` → StepRun `running`, `stopped` and `interrupted` → StepRun `interrupted`, `ended` → done or failed; any other state changes nothing. `packages/contracts/src/api/phase-runs.ts`: `PHASE_RUN_WAITING_ON` = `queue`, `decision`, `source-migration`; `STEP_RUN_STATES` has `waiting`.
- `packages/contracts/src/api/decisions.ts`: `DECISION_KINDS`, `DECISION_TONES` (`accent`, `caution`, `halt`); `apps/server/src/decisions/decisions.service.ts` `raise` (one open per `(kind, subjectId)`) and `resolve`. `apps/web/src/views/decisions/registry.ts` (`registerDecisionView`, `DecisionAction` with `needsRunner`), `session-request.ts` (opens a Session from a Décision).
- `apps/web/src/views/session.ts` (pure: the Session's data and children for the `Session` Composant; `SHOWN_STATE`), `apps/web/src/session-panel.ts` (opens the Session, relay, `stopSession`, `resumeSession`), `apps/web/src/api/sessions.ts`, `apps/web/src/sessions/relay.ts` (decrypted events in memory only); Composant `packages/contracts/src/composants/session.ts` (state `active|waiting|stopped|interrupted|failed`, actions `stop`, `resume`, `close`, `expand`, `resumeDisabledReason`), skin `packages/skin-passerelle/src/session.ts`. `CodeBlock` and `Banner` exist as Composants.
- A Commande's output reads as a Session (US-104) but is not an `AgentSession`: `apps/web/src/commands/output.ts`.
- Created by RUNNER-22: `session.hand-off`, `session.hand-off.refused`, the `handed-off { command, machine }` event, `session.state` `handed-off`, the worktree kept. Created by BOUCLE-2: `LoopRecord` (`interruptedAt?`, `queuedAt?`), the slot (a PhaseRun `waiting` frees it), `loop-scheduler.ts`, `/boucle` with its `AgentRow`. Created by BOUCLE-7 and BOUCLE-5: the « Interrompu » card, the Ticket's page `/projets/:id/tickets/:number` and its `ticketTrack`. Created by ATOI-2: the Décisions of an Étape that fails.

## To do

- Prisma (one migration): `AgentSessionState` gains `handed_off`; `LoopRecord.handedOffAt DateTime?`.
- Contracts: `SESSION_STATES` gains `handed-off` (RUNNER-22; the Prisma value `handed_off` is mapped as the other multi-word values are); `LIVE_SESSION_STATES` and `RESUMABLE_SESSION_STATES` do not include it; `PHASE_RUN_WAITING_ON` gains `pilot-terminal`; `DECISION_KINDS` gains `session-handed-off`; `DECISION_TONES` gains `neutral` (the mockup's tone; added to `DecisionRow`'s tone and its skin rendering); `zLoopRecord.handedOffAt`; `pnpm exec nx run contracts:generate`.
- Server `apps/server/src/sessions/hand-off.ts`, `SessionsService.handOff(id, seq)`, in the Pilote's `serial` scope:
  - `POST /api/sessions/:id/hand-off { seq }` (`zSessionAction`), returns the `AgentSession`. 404 `sessions.not-found` (also another Pilote's), 409 `realtime.stale`, 422 `session.not-handable` when the Session is `ended` or already `handed_off` (a Commande is not an AgentSession: it has no route), 422 `runner.offline`, 422 `session.no-terminal` (« Cette Session ne peut pas être reprise dans un terminal. ») when the Runner answers `session.hand-off.refused` `no-terminal`.
  - A Session `starting`, `active`, `waiting`, `stopped` or `interrupted` can be handed off: a stopped one too (it has its worktree and its Moteur's id).
  - It sends `session.hand-off { sessionId }` and waits at most 10 s for the Runner's `session.state` `handed-off` or its `session.hand-off.refused` (a small registry of pending hand-offs by session id, as BOUCLE-5 waits for `comment.written`), then answers; no answer in 10 s: 422 `session.hand-off-timeout`, nothing written. The state change itself is made by `report` (the Runner's word), not by the route.
  - `report`: a `handed-off` state on a Session that is `LIVE`, `stopped` or `interrupted` becomes `handed_off` (`interruptedReason: null`, `endedAt: null`), writes `agent-session.upserted`, calls the hooks; from `handed_off` the server then takes only `ended`. The requests of the turn the stop cut: their Décisions resolved `withdrawn` (`resolveOpenRequests`).
  - French messages in `apps/server/src/errors/messages.ts`.
- Hook for the Process (`apps/server/src/process/engine/kinds/agent.ts` `onSession`): `handed_off` → the StepRun `waiting`; the engine puts its PhaseRun `waiting` with `waitingOn: 'pilot-terminal'` (a value of `PHASE_RUN_WAITING_ON`, which the engine's `advance` and the Boucle's slot treat as « waiting for the Pilote »: the slot is freed, nothing starts in that PhaseRun). Nothing else moves: the StepRun's Session stays recorded. A Session with no StepRun (`stepRunId` null) changes no Process state.
- Boucle (`apps/server/src/loops/`): on a `ticket.ready` PhaseRun, `LoopRecord.handedOffAt = now`, `LoopRecord` event `loop-record.upserted` in the same transaction. `loop-scheduler.ts` takes a LoopRecord for `Engine.startQueued` only when it has `queuedAt`, and never one with `handedOffAt` and no `queuedAt`; it does not admit the Ticket again (its LoopRecord is open). Its dependents wait through `blockedBy`, unchanged. Stopping the Boucle (BOUCLE-2) does not touch a handed-off Ticket (its PhaseRun is not `running`).
- Décision `apps/server/src/decisions/`: kind `session-handed-off`, `subjectType: 'session'`, `subjectId` the Session's id, tone `neutral`, `label` « #<n> » plus the readable title for a GitHub Ticket (the page completes a Local one) or the Étape's name in the pinned definition when the Session belongs to no Ticket, `metaParts` [Projet, Rôle's name, « sur <machine> » from `Runner.machine`], `link` `?session=<id>`, `params { sessionId, stepRunId, ticketNumber?, machine, hasTicket }` (ids and the machine's name, never a command or a path). Raised in the transaction of the change to `handed_off`; one open per Session. It stays open until SESSION-6 resolves it (`given-back`, `returned-to-loop`), or the Session ends otherwise (`resolve(..., 'ended')` through the `ended` hook).
- Web:
  - `apps/web/src/api/sessions.ts` `handOff(client, id, seq)`; t() keys `session.terminal.*` and `decision.sessionHandedOff.*` in `packages/sdk/src/i18n/fr.ts` (copy from `session.html` and `session-terminal.html`).
  - The `Session` Composant (version bump, `packages/contracts/src/composants/session.ts` and its skin): state `handed-off` (« reprise hors Crewdeck »), a new action `terminal` and `terminalDisabledReason`, `terminal: boolean` (false: no « Continuer dans mon terminal »); the action row under the title: « Arrêter » or « Reprendre » (or none when the Banner of the stream offers the choices, SESSION-4), then « Continuer dans mon terminal » (icon `terminal`), absent once handed off. `apps/web/src/views/session.ts` fills it for every state of an `AgentSession` (default, question, permission, `arretee`, `runner-hors-ligne`); disabled with the Runner offline, as drawn (`terminalDisabledReason` the same text as `resumeDisabledReason`).
  - The click in `apps/web/src/session-panel.ts`: `handOff`, then, once the relay gives the `handed-off` event of that Session in this tab (the tab that asked), `navigator.clipboard.writeText(command)`; the time of the copy is kept in memory for the Banner. A refused write (browser permission, gesture expired) leaves the command displayed.
  - The panel of a `handed_off` Session (`session-terminal`): the stream as before, a Banner `neutral` icon `terminal` « Reprise hors Crewdeck depuis <date>, sur <machine> » with « La commande a été copiée <date> ; colle-la dans un terminal de <machine> pour reprendre la Session dans son worktree. » and, when the Session has a Ticket, « La Boucle ne reprend pas #<n> ; #<m>, qui en dépend, attend. » (the dependents' numbers read from the store's `blockedBy`), a `CodeBlock` with the command and its copy button (read from the `handed-off` event through the relay, memory only; Runner offline: « Ouvre la Session… » as SESSION-3 does, the command not shown), the disabled Composer « Session reprise dans ton terminal ». The card « Quand tu as fini » and its two buttons are SESSION-6's.
  - « À toi »: `apps/web/src/views/decisions/session-handed-off.ts`, `registerDecisionView`: kind « Repris hors Crewdeck », icon `terminal`, title the label (the page completes a Local Ticket's), context « Rendre la main vérifie ton travail contre le Contrat de l'Étape <Étape> ; Rendre à la Boucle la laisse reprendre #<n>. #<m>, qui en dépend, attend. » (for a Session with no Ticket: only the first half), action « Ouvrir la Session » (`needsRunner: false`) opening the panel; SESSION-6 adds its two buttons.
  - « repris hors Crewdeck »: on `/boucle` the Ticket's `AgentRow` / `TicketRow` of a LoopRecord with `handedOffAt` reads « Repris hors Crewdeck » (tone `neutral`); on the Ticket's page (BOUCLE-5) the Étape of the handed-off StepRun in `ticketTrack` reads the same.
- Test scenarios `apps/server/src/testing/scenarios/session.ts` gain `session-terminal` (a Code Session of a Ticket handed off on the fake Runner, a dependent Ticket) and the existing `session*` scenarios get the action row; Playwright `apps/web/e2e/session.spec.ts` and `a-toi.spec.ts`.

## Decisions already made

- Mockup: `session`, `session-terminal` (pages `design/screens/crewdeck/session.html`, `…/session-terminal.html`; captures `…-390.png`, `…-1280.png`; the other `session-*` pages show the action row on each of their states). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The server cannot read the command: it is in the Session's encrypted log, read by the page (ADR 0003, SEC-11). Hence the Décision holds only ids and the machine's name, and the command shows in « Ouvrir la Session » only.
- The state change is the Runner's, never optimistic: a refusal leaves the Session as it was (the Pilote's terminal would otherwise be told to resume a Session still running).
- « Continuer dans mon terminal » is on every `AgentSession`, whatever its state, once it has a Moteur's id; a Commande has none (it is no Session of an agent); the Session sans progrès of SESSION-4 shows it next to its own choices.
- The Ticket's slot is freed (the PhaseRun is `waiting`, like a Décision of the Pilote): the Boucle goes on with the Tickets that do not depend on it, as for a blocked Ticket (US-15).
- A Session of no Ticket (a Conception or Idée Étape) is handed off the same way; only the Ticket's mark and the Boucle's rules are absent.
- Only the tab that asked writes to the clipboard; another Appareil showing the panel shows the command and its copy button. The banner's « La commande a été copiée » is shown only when the write succeeded; otherwise the copy button of the `CodeBlock` stays the way, and the sentence reads « Colle la commande ci-dessous dans un terminal de <machine> pour reprendre la Session dans son worktree. »
- The `neutral` tone is a new tone of the Décision (the mockup draws it): no urgency, no push notification is sent for this kind (the Pilote just asked for it).

## Acceptance criteria

- [ ] « Continuer dans mon terminal » is under the title of a running, waiting, stopped and interrupted Session, after « Arrêter » or « Reprendre »; absent on a Commande's output; disabled with the Runner offline.
- [ ] Choosing it hands the Session off: its state becomes `handed-off` in the panel, the command is in the clipboard of the tab that asked (a test with a fake clipboard) and shown with a copy button, the Banner names the machine.
- [ ] The Ticket's PhaseRun is `waiting` (`waitingOn: 'pilot-terminal'`), the Boucle's slot is free and the next ready Ticket that does not depend on it is admitted; the handed-off Ticket is never taken back by the tick; `/boucle` and the Ticket's page say « Repris hors Crewdeck ».
- [ ] A « Repris hors Crewdeck » Décision is in « À toi » within 2 s, with « Ouvrir la Session », and stays until SESSION-6 settles it; one per Session.
- [ ] The stored Décision, the `AgentSession` row, the events and the server's logs hold no command and no worktree path (test on the stored rows and on `session.hand-off`).
- [ ] A Runner that cannot resume the Moteur in a terminal: 422 `session.no-terminal`, the Session unchanged and running.
- [ ] Routes: 422 `runner.offline`, 422 `session.not-handable` (ended, or already handed off), 422 `session.hand-off-timeout`, 409 stale `seq`, 404 for another Pilote's Session, 401, 400 with `fields`; each change writes its event in the same transaction.
- [ ] After a Runner restart a handed-off Session stays `handed_off` (not interrupted, not resumed by the Runner's reconnection).
- [ ] The screens `session`, `session-terminal` and the other `session-*` states match their mockups at 390 and 1280 px (Playwright on the fake Runner, axe without violations).

## Verification

- `pnpm exec nx test server -- src/sessions/hand-off.spec.ts`
- `pnpm exec nx test web -- src/views/session.spec.ts src/views/decisions/session-handed-off.spec.ts`
- `pnpm exec nx test contracts`, `pnpm exec nx test skin-passerelle -- src/session.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- sessions`
- `pnpm exec nx e2e web -- session.spec.ts`, `pnpm exec nx e2e web -- a-toi.spec.ts`
- `scripts/captures.sh session session-arretee session-runner-hors-ligne session-terminal` (390 and 1280 px)
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

A migration (`agent_session_state` value `handed_off`, column `loop_records.handed_off_at`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The Runner's hand-off, the command per Moteur and the log event: RUNNER-22.
- « Rendre la main » and « Rendre à la Boucle », the card « Quand tu as fini » and the Décision's two buttons: SESSION-6.
- The choices of a Session sans progrès and its banner: SESSION-4.
- A Commande's output and its « Relancer »: PROCESS-12.

## Dependencies

- RUNNER-22
- BOUCLE-2
- BOUCLE-5 (the Ticket's page and its `ticketTrack`)
