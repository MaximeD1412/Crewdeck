---
id: SESSION-4
title: "Décision « Session sans progrès »: relaunch the Étape, resume the Session or block the Ticket"
epic: SESSION
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [RUNNER-21, BOUCLE-7, BOUCLE-5]
adr: [0003, 0004, 0007, 0008]
risques: []
stories: [US-112]
screens: [session-sans-progres]
revue_visuelle: true
video: false
---

## Context

US-112: when the Runner's watchdog (RUNNER-21) interrupts a Session of an **Étape** for lack of event (« Sans événement ») or of progress (« Sans progrès »), the Pilote is told in « À toi » and in the Session's panel, and chooses: « Relancer l'Étape », « Reprendre la Session » or « Bloquer le Ticket ». Until they choose, a Ticket's **PhaseRun** does not hold the Boucle's slot: the Boucle goes on with the Tickets that do not depend on it (BOUCLE-7). This ticket turns the interruption into a **Décision**, gives it its three actions, and draws the banner of the panel.

## Current state of the code

- `apps/server/src/sessions/sessions.service.ts`: `report` stores the Runner's `session.state` (RUNNER-21 adds `interruptedReason` and `idleSinceAt`), `start`, `resume` (`POST /api/sessions/:id/resume`), `SessionHooks.onChanged` (`session-hooks.ts`). Nothing raises a Décision when a Session is interrupted.
- `apps/server/src/process/engine/engine.ts` and `kinds/agent.ts`: `onSession` finishes the StepRun on a Session's end; `AGENT_STEP_FAILURES` and `RERUNNABLE_FAILURES` hold the failures the Pilote may rerun; `Engine.retry` reruns a StepRun that failed. `kinds/step-run-hooks.ts` has only `onFinished`. `step-decisions.ts`: `STEP_DECISION_KINDS = ['contract-incomplete', 'step-failed']`, one open Décision per StepRun (`raise`, resolved when the StepRun finishes). `step-runs.controller.ts`: `POST /api/step-runs/:id/rerun`, today for a failed StepRun.
- `packages/contracts/src/api/decisions.ts`: `DECISION_KINDS` (plain strings in the table, no migration for a new kind); a Décision has `subjectType`, `subjectId`, `label`, `params`, a `link`; one open per (kind, subjectId). `apps/server/src/notifications/push-payload.ts`: label per kind (`'step-failed': 'Étape échouée'`).
- BOUCLE-7: `LoopRecord.interruption` and the requeue (`queuedAt`) of a Ticket's PhaseRun; BOUCLE-5: the Boucle's controls and the Ticket's blocking on the Boucle side (`blocked`), without a route for the Pilote to block a Ticket from a StepRun.
- Web: `apps/web/src/views/decisions/registry.ts` (kind to view), `views/decisions/step-failed.ts` and `step-run.ts` (model for a Décision view and its StepRun actions), `apps/web/src/api/step-runs.ts`, `apps/web/src/views/session.ts` (the Session's panel, `Session` Composant), `apps/web/src/views/a-toi.ts`.
- Runner: `apps/runner/internal/session/manager.go` (`Resume`, `Stop`), `record.go` (the Session's record, `Step`), `worktree.go`. A rerun creates a new Session on the Étape's branch: the old Session must be released first.
- Mockup: `design/screens/crewdeck/session-sans-progres.html` (the panel with a banner « Sans progrès depuis <n> min » and its three actions, the interrupted Session's last events above).

## To do

- **Contract** (`packages/contracts/src/api/decisions.ts`, `process`): Décision kind `session-stalled`, subject `step-run`, `params { reason: 'no-event' | 'no-progress', minutes, role, stepRunId, sessionId, ticketNumber? }` (no content: ADR 0003), outcomes `rerun | resumed | blocked`. A new failure `session-stalled` in `AGENT_STEP_FAILURES` (and in `RERUNNABLE_FAILURES`). `POST /api/step-runs/:id/block { seq }`, 204. `Session` Composant version 3: `noResume: boolean` (a Session with no worktree left to resume), `stalled: { reason, minutes } | null`; actions `relaunch`, `resume`, `block` (cd-action, no handler in the Composant). `pnpm exec nx run contracts:generate`.
- **Server, interruption** (`kinds/agent.ts`, `step-decisions.ts`, a new hook beside `onFinished` in `step-run-hooks.ts`): `onSession` of a Session interrupted with `no-event` or `no-progress` leaves the StepRun in `interrupted` (it does not finish it as an end of Session) and calls the new hook; `StepDecisions` raises `session-stalled` (label « Session sans progrès · <Étape> », tone `caution`, link to the Session's panel, one open per StepRun), writing the `decision.upserted` event and the Session's in the same transaction (ADR 0007). The Décision resolves on any action below, or when the StepRun leaves `interrupted` for any reason (the Ticket blocked, the Étape rerun, a manual stop). For a PhaseRun of `ticket.ready`: the PhaseRun goes `waiting` and `LoopRecord.interruption` (BOUCLE-7) takes a new reason `stalled` (added to the `reason` union of `zLoopRecord.interruption`, `{ reason: 'stalled', stepRunId }`), which frees the slot; the Boucle goes on with the Tickets that do not depend on it. For another PhaseRun: it waits with its Décision, the slot is not concerned.
- **Server, actions**:
  - « Relancer l'Étape »: `POST /api/step-runs/:id/rerun`, widened to a StepRun `interrupted` with the failure `session-stalled` (`Engine.retry` too). The old Session is released first: a Runner message `session.discard { sessionId }` (the Session's worktree and branch are reused, its content kept in the Miroir) sent on the Runner's socket, the new Session started on its answer; 422 `runner.offline` when the Runner is not connected. The Décision resolves `rerun`; for `ticket.ready`, the PhaseRun is requeued ahead (`queuedAt`, BOUCLE-7).
  - « Reprendre la Session »: `POST /api/sessions/:id/resume` as today (thresholds re-read from `SettingsService.effective`, the clock of the watchdog restarts); the Décision resolves `resumed`. For `ticket.ready`, the PhaseRun is requeued (BOUCLE-7); if the slot is taken meanwhile, it waits its turn and the Session resumes when it gets it (409 `loop.slot-busy` is never shown: the answer says « en attente de la Boucle »).
  - « Bloquer le Ticket »: `POST /api/step-runs/:id/block { seq }`, only for a StepRun of `ticket.ready` (409 `step-run.not-blockable` otherwise): the Session is stopped, the StepRun finishes `blocked`, the Ticket takes the label `blocked` (BOUCLE-5's blocking, same transaction), the Décision resolves `blocked`. A Session with no Ticket (idea, design) offers no « Bloquer le Ticket ».
  - All three: `seq` as the other actions of a StepRun (409 `realtime.stale` when the Décision was resolved elsewhere), 401 without a session, another Pilote's StepRun is a 404.
- **Runner** (`apps/runner/internal/session/manager.go`, `protocol`): `session.discard { sessionId }`: the Session is stopped if running, its record marked `discarded`, the worktree kept for the next Session of the Étape; answered by `session.state`. `session.resume` of a `discarded` Session is refused (`session.discarded`).
- **Web**: `apps/web/src/views/decisions/session-stalled.ts`, registered in `registry.ts`: the Décision's card in « À toi » (label, reason, « <n> min » of `minutes`, the three buttons, « Bloquer le Ticket » hidden without a Ticket). `apps/web/src/api/step-runs.ts` gains `blockStepRun`; `views/session.ts`: the banner of the panel from `stalled` (« Sans événement depuis <n> min » / « Sans progrès depuis <n> min »), the same three buttons, `noResume` hiding « Reprendre la Session »; a refusal shows under the buttons, a second tab sees the Décision resolve without reloading. t() keys `session.stalled.*`, `decisions.session-stalled.*`; `apps/server/src/notifications/push-payload.ts` label « Session sans progrès ».
- **Tests**: `apps/server/src/process/engine/kinds/agent.spec.ts` and `step-decisions.spec.ts` (raise, one open, resolve on each outcome and on a manual stop), integration `sessions` and `step-runs` (the three routes, `seq`, 401, 404, 409, 422), `apps/runner/internal/session/manager_test.go` (`discard`, a discarded Session refuses a resume), `apps/web/src/views/decisions/session-stalled.spec.ts` and `session.spec.ts`, skin spec of `Session`, scenario `apps/server/src/testing/scenarios/session.ts` (state `sans-progres`, a Session interrupted after 45 min), Playwright `apps/web/e2e/session.spec.ts`.

## Decisions already made

- Mockup: `session-sans-progres` (page `design/screens/crewdeck/session-sans-progres.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Reasons are `no-event` and `no-progress` in the contracts (RUNNER-21), the Décision's `reason` reuses them; the server stores no content, the Runner measures, the server stores the reason and the minutes.
- One open Décision per interrupted StepRun, whichever the reason; the Décision is never raised for a Session the Pilote stops themselves.
- A Décision kind is a plain string: no migration; the PhaseRun's `waitingOn` stays one of `queue | decision | source-migration` and a stalled PhaseRun is `decision`.
- « Relancer l'Étape » starts a fresh Session on the same worktree (the first one is discarded, never run in parallel); « Reprendre la Session » keeps the Session's context (the Moteur's resume).
- Only the Sessions of an Étape are watched (RUNNER-21): this Décision never concerns a conversation.

## Acceptance criteria

- [ ] A Session interrupted by the watchdog for `no-event` or `no-progress` raises one open Décision `session-stalled`, visible in « À toi » with its reason and minutes, and a banner in the Session's panel; a second interruption of the same StepRun raises none more.
- [ ] While it is open, a `ticket.ready` PhaseRun does not hold the Boucle's slot: the next Ticket that does not depend on it starts.
- [ ] « Relancer l'Étape » discards the old Session, starts a new one on the same worktree, resolves the Décision `rerun`, and the PhaseRun is requeued ahead; with the Runner offline: 422 `runner.offline`, the Décision stays open.
- [ ] « Reprendre la Session » resumes it with the thresholds in effect, resolves `resumed`; a slot taken meanwhile makes it wait its turn.
- [ ] « Bloquer le Ticket » stops the Session, finishes the StepRun `blocked`, labels the Ticket `blocked`, resolves `blocked`; a Session with no Ticket does not offer it, the route answers 409 `step-run.not-blockable`.
- [ ] A stale `seq` is refused with 409 `realtime.stale`; 401 without a session; another Pilote's StepRun is a 404; the Décision resolved elsewhere disappears from « À toi » without reloading.
- [ ] Every change writes its event in its transaction; nothing in the Décision's params is content (ADR 0003).
- [ ] Screen `session-sans-progres` at 390 and 1280 px matches the mockup, axe without violations.

## Verification

- `pnpm exec nx test server -- src/process/engine/step-decisions.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- sessions`, `pnpm exec nx test-integration server -- step-runs`
- `cd apps/runner && go test ./internal/session/ -run TestDiscard`
- `pnpm exec nx test contracts`, `pnpm exec nx test skin-passerelle -- src/session.spec.ts`, `pnpm exec nx test web -- src/views/decisions/session-stalled.spec.ts`
- `pnpm exec nx e2e web -- session.spec.ts`; `scripts/captures.sh session-sans-progres` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

No migration (a Décision kind is a string; the failure is a contract value). The Runner is a new version (`session.discard`): mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The watchdog and the thresholds' application: RUNNER-21; their editing: PARAM-5.
- The Boucle's slot and requeue mechanics: BOUCLE-7; the Boucle's controls: BOUCLE-5.
- Automatic relaunch without the Pilote.
- Watching the conversations' Sessions.

## Dependencies

- RUNNER-21: the interruption reasons, `idleSinceAt`, the thresholds.
- BOUCLE-7: the `stalled` interruption and the requeue of a Ticket's PhaseRun.
- BOUCLE-5: the blocking of a Ticket on the Boucle's side.
