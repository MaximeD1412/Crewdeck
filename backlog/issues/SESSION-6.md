---
id: SESSION-6
title: "« Rendre la main » (the Contrat checked again on the worktree) and « Rendre à la Boucle » (the work kept)"
epic: SESSION
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [SESSION-5, BOUCLE-7]
adr: [0003, 0004, 0005, 0007, 0008, 0011]
risques: [IA-6]
stories: [US-113]
screens: []
revue_visuelle: false
video: false
---

## Context

US-113: after the Pilote worked in their terminal on a handed-off **Session** (SESSION-5), two ways give the work back. « Rendre la main »: the **Contrat** of the Session's **Étape** is checked again on what the Pilote left in the worktree, then the **Process** goes on from there (the Pilote's work counts as the Étape's output). « Rendre à la Boucle »: the **Boucle** takes the Ticket back and resumes the same Étape on top of the Pilote's work. Risk IA-6 (a deliverable half done): the check is the same as an agent's, so the Pilote's hand-made work cannot skip it.

## Current state of the code

- `apps/runner/internal/session/step.go`: `sendVerdict(w Worktree, rec record)` loads the Étape's Contrat (`contrat.Get`), reads the change (`m.cfg.ChangeOf`), runs `contrat.Check(ctx, c, contrat.Target{Dir, IntegrationBranch, PR})` and sends `step.verdict`; called when an Étape's Session ends. `manager.go`: `Resume`, `reviveLocked`, `finish` (Clean, worktree removed, `ended`), `end`; `Stop`.
- `packages/contracts/src/runner/step.ts`: `step.start`, `step.report`, `zStepVerdict` (`step.verdict { stepRunId, verdict }`, verdict `passed | incomplete` with failed rule ids only). `packages/contracts/src/runner/session.ts`: `zSessionResume`.
- `apps/server/src/process/engine/kinds/agent.ts`: `step.verdict` → `Engine.recordContratVerdict` (stored in `StepRun.contratVerdict`); a Session `ended` finishes the StepRun through `onEnded` (`done` with its outputs when the Contrat passed, `failed` `contract-incomplete` otherwise, `StepRunHooks.finished`). `engine.ts`: `signal`, `recordContratVerdict`, `retry`, `rerunFrom`. `apps/server/src/process/engine/step-decisions.ts` (ATOI-2): `contract-incomplete` and `step-failed` Décisions raised on `onFinished`.
- `apps/server/src/sessions/sessions.service.ts`: `resume` (RESUMABLE states only, 422 `runner.offline`), `report` (takes `ended` always), `SessionHooks.onEnded`.
- Created by SESSION-5: `AgentSessionState` `handed_off`, `POST /api/sessions/:id/hand-off`, the PhaseRun `waiting` with `waitingOn: 'pilot-terminal'`, `LoopRecord.handedOffAt`, the Décision `session-handed-off` (open, « Ouvrir la Session » only), the `Session` Composant's `handed-off` state and the panel's banner, `apps/web/src/views/decisions/session-handed-off.ts`. Created by RUNNER-22: the Runner's `HandOff` and the `handed-off` record. Created by BOUCLE-2: `LoopRecord.queuedAt` (the slot's first), `Engine.startQueued`; by BOUCLE-7: `POST /api/projects/:id/tickets/:number/resume` and its path (resume the interrupted StepRun's Session, a new StepRun of the same Étape and iteration on the current head for an Étape that judges or a Session that cannot resume). Created by ATOI-2: `POST /api/step-runs/:id/rerun`.

## To do

- **Protocol** (`packages/contracts/src/runner/step.ts` and `session.ts`, shared fixtures valid in TypeScript and Go, `pnpm exec nx run contracts:generate`): server → Runner `step.check { stepRunId }` (`zStepCheck`) and `session.release { sessionId }`; the answer of `step.check` is the existing `step.verdict` or Runner → server `step.check.failed { stepRunId, code }`; the refusal of `session.release` is `session.release.failed { sessionId, code }` (codes only, never a path or a file name).
- **Runner** `apps/runner/internal/session/giveback.go`:
  - `Manager.Check(stepRunID)`: finds the handed-off Session of that StepRun, refuses a Session not `handed-off` (ignored); runs the check of `sendVerdict` on its kept worktree: the body of `sendVerdict` is extracted as `check(w, rec) (Verdict, code)` and both callers use it (same Target: the worktree, the integration branch, the change read from the Miroir); sends `step.verdict`; then `finish(s, w, made, ok, "")` (Clean, worktree removed, `ended` / `outcome: ok`) and reports it. Before the check, a worktree with uncommitted changes (`git status --porcelain` not empty: what `.gitignore` hides does not count) is refused with the code `uncommitted`, and nothing runs. A check that fails or is refused (`uncommitted`, `unknown-contrat`, `change-unread`, `check-failed`) sends no verdict: the Session stays `handed-off` and the Runner reports `step.check.failed { stepRunId, code }` (codes only); a second `step.check` while one runs is ignored.
  - `Manager.Release(sessionID)` (`session.release`): ends a `handed-off` Session without a check (`ended` / `ok`, Clean, worktree removed). A worktree with uncommitted changes is refused the same way: `session.release.failed { sessionId, code: 'uncommitted' }`, the Session stays `handed-off`. Used for a Session of no Étape and by the return to the Boucle of an Étape that judges.
  - `Manager.Resume` accepts a `handed-off` record: it is revived as a stopped Session, in its kept worktree, on its Moteur's id (the commits and files the Pilote left are on the worktree).
- **Server** `apps/server/src/sessions/give-back.ts`, both in the Pilote's `serial` scope, one transaction each, `{ seq }` (`zSessionAction`):
  - `POST /api/sessions/:id/give-back` « Rendre la main »: 404 `sessions.not-found`, 409 `realtime.stale`, 422 `session.not-handed-off`, 422 `runner.offline`. A Session with a StepRun: sends `step.check { stepRunId }`; the verdict comes back as `step.verdict`, recorded by the engine (`recordContratVerdict`), then the Session's `ended` (`outcome: ok`) finishes the StepRun through the existing `onEnded`: `passed` → the StepRun `done` and the Process goes on (`signal`), the PhaseRun back to `running` and its next Étape starts; `incomplete` → the StepRun `failed` `contract-incomplete`, ATOI-2's « Contrat incomplet » Décision with its « Relancer l'Étape », the PhaseRun `waiting` on it. A Session with no StepRun: `session.release`, the Session ended. The Décision `session-handed-off` is resolved `given-back` when the Session ends (the `ended` hook), so a Runner that never answers leaves it open and the button usable again. The route waits at most 30 s for the Runner's answer (the pending registry of SESSION-5's hand-off): `step.verdict` → 200 with the Session; `step.check.failed` or `session.release.failed` → 422 `session.check-failed` with the French message of its code (`uncommitted`: « Des fichiers du worktree ne sont pas commités : commite-les ou jette-les dans ton terminal, puis rends la main. »), nothing changed on the server: the Session stays `handed_off`, the Décision open and its buttons usable again; no answer in 30 s → 200 with the Session unchanged, the verdict applies when it comes.
  - `LoopRecord.handedOffAt` cleared; the LoopRecord of a Ticket whose Contrat passed continues with its PhaseRun as any other, taking the slot through BOUCLE-2's guard (`queuedAt` when the slot is held).
  - `POST /api/sessions/:id/return-to-loop` « Rendre à la Boucle »: same errors, plus 422 `session.not-in-ticket` (« Cette Session n'appartient à aucun Ticket de la Boucle. ») unless its StepRun belongs to a PhaseRun of a `ticket.ready` Phase. In one transaction: `handedOffAt` cleared and `queuedAt` set (the slot's first), the Décision resolved `returned-to-loop`, the PhaseRun `running` again. For an Étape that judges, `session.release` is sent and its answer awaited first (≤ 30 s), before the transaction: a refusal (`uncommitted`) is the same 422 `session.check-failed`, nothing changed. Then BOUCLE-7's resume path, reused as `SessionsService`/`loops` functions (not re-written): an Étape that does not judge: the Session `starting` and `session.resume` sent (the Runner revives the `handed-off` record in its kept worktree, so the agent resumes with the Pilote's commits and files); an Étape that judges (`review` kind), or a Session with no Moteur's id: `session.release` for the old Session then a new StepRun of the same Étape and iteration on the current head (PROCESS-4's rerun). The Boucle's own ticks start it once the slot is free; a Boucle that is stopped keeps it queued until its next start.
  - French messages in `apps/server/src/errors/messages.ts` (`session.not-handed-off`, `session.not-in-ticket`, `session.check-failed` and one message per code).
- **Web**:
  - `apps/web/src/api/sessions.ts`: `giveBack(client, id, seq)`, `returnToLoop(client, id, seq)`.
  - The Décision row `session-handed-off.ts` (SESSION-5): the two actions « Rendre la main » and « Rendre à la Boucle » (`needsRunner: true`, so disabled with the Runner offline, as drawn); « Rendre à la Boucle » only when `params.hasTicket`. The panel (`apps/web/src/session-panel.ts`, the `Session` Composant's `handed-off` state): the card « Quand tu as fini » with its two sentences and buttons (« Rendre la main » primary with icon `check`, « Rendre à la Boucle » icon `loop`, the second absent without a Ticket), disabled with the Runner offline, copy from `session-terminal.html` and `a-toi-depuis-derniere-visite.html`; t() keys `session.terminal.*` and `decision.sessionHandedOff.*`. A refusal (a 422) goes through `announce` with its French message; the Décision leaves « À toi » by the store's event, never by hand.
- Tests: Go `giveback_test.go` on the fake Moteur and a worktree (a check passed: `step.verdict` then `ended`, worktree removed; incomplete; a `step.check.failed` leaves `handed-off`; an uncommitted file refused (`uncommitted`) by `Check` and `Release`, the file still there; `Release`; `Resume` of a `handed-off` record), server `give-back.spec.ts` and integration (`pnpm exec nx test-integration server -- sessions`), the scenario `session-terminal` of SESSION-5 extended with a passing and a failing worktree on the fake Runner, Playwright in `apps/web/e2e/session.spec.ts` and `a-toi.spec.ts` (no visual review: the look is SESSION-5's).

## Decisions already made

- « Rendre la main » asks nothing about what the Pilote did: the Contrat of the Étape judges it, as it judges an agent's work (risk IA-6). A failing Contrat is the usual « Contrat incomplet » Décision, whose « Relancer l'Étape » starts a new Session of the Étape on the same branch. The Session has ended and its worktree been removed by then, so the Runner first refuses a worktree with uncommitted changes (`uncommitted`): nothing the Pilote left is ever removed silently; they commit it or throw it away in their terminal, then give it back.
- The work kept: « Rendre à la Boucle » resumes the same Session in the same worktree for an Étape that does not judge; an Étape that judges gets a new pass on the current head (BOUCLE-7's rule: a review is cheap to redo). In that case the worktree is released, refused as above while it has uncommitted changes, and the new pass sees what is on the branch.
- The server never sends a path nor a command: `step.check` carries the StepRun's id, the Runner finds the worktree in its own record (SEC-11).
- Giving back ends the handed-off state in one direction only; a Session cannot be handed off again while a give-back runs (the route is 422 `session.not-handed-off` once ended or resumed), and handing it off again after a return to the Boucle is a new hand-off.
- A Session of no Ticket (Conception or Idée Étape) has « Rendre la main » only: there is no Boucle to return to.
- Resolution happens where the truth is: « Rendre à la Boucle » resolves its Décision at once (the work is queued); « Rendre la main » when the Session ends, so a Runner that does not answer does not make the Décision vanish.

## Acceptance criteria

- [ ] « Rendre la main » on a handed-off Code Session whose worktree satisfies the Contrat: the verdict `passed` is recorded, the Session ends, the StepRun is `done`, the Décision leaves « À toi » and the Process goes on to the next Étape of the PhaseRun, the Boucle's slot taken as for any Ticket.
- [ ] The same with a worktree that misses a rule: the StepRun is `failed` `contract-incomplete`, « Contrat incomplet » shows in « À toi » with the failed rule's label, « Relancer l'Étape » starts a new Session of that Étape.
- [ ] « Rendre à la Boucle » on a Ticket's Session: `handedOffAt` cleared, `queuedAt` set, the Décision resolved, and the Boucle resumes the Étape's Session in the same worktree with the Pilote's commits present (checked on the fake Runner's worktree); a `review` Étape gets a new StepRun on the current head instead.
- [ ] A Session that belongs to no Ticket shows « Rendre la main » only; `POST /api/sessions/:id/return-to-loop` on it gives 422 `session.not-in-ticket`.
- [ ] With the Runner offline the two buttons are disabled in the panel and the Décision's row, and both routes give 422 `runner.offline`; the Décision stays.
- [ ] A worktree with an uncommitted file: « Rendre la main », and « Rendre à la Boucle » of an Étape that judges, give 422 `session.check-failed` with the « pas commités » message; the file is still in the worktree, the Session `handed-off`, the Décision open.
- [ ] A Runner whose check fails (`check-failed`) leaves the Session `handed-off` and the Décision open, and the buttons usable again.
- [ ] 422 `session.not-handed-off` on a Session not handed off (resumed, ended, or stopped), 409 on a stale `seq`, 404 for another Pilote's Session, 401, 400 with `fields`; each change writes its event in the same transaction.
- [ ] A second « Rendre la main » while the check runs does nothing more (one `step.verdict`, one end).
- [ ] The shared fixtures of `step.check`, `step.check.failed`, `session.release` and `session.release.failed` validate in TypeScript and Go; no message carries a path or a command.
- [ ] Playwright: the buttons show and act in the panel and in « À toi » at 390 and 1280 px, axe without violations.

## Verification

- `pnpm exec nx test server -- src/sessions/give-back.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- sessions`
- `cd apps/runner && go test ./internal/session/ -run 'GiveBack|Release|Resume' && go test ./internal/protocol/`
- `pnpm exec nx test web -- src/views/decisions/session-handed-off.spec.ts`
- `pnpm exec nx test contracts`
- `pnpm exec nx e2e web -- session.spec.ts`, `pnpm exec nx e2e web -- a-toi.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing (no schema change: SESSION-5 owns the migration).

## Out of scope

- The hand-off itself, the command, the banner and the Décision's first appearance: SESSION-5; the Runner's half: RUNNER-22.
- The interruption and resume of a Ticket by a limit or the Runner stopping: BOUCLE-7 (its path is reused, not changed). A Retour after a changed verdict: PROCESS-6.
- A merge done by the Pilote in their terminal (« Rendre la main » only checks the Étape's Contrat): BOUCLE-4.

## Dependencies

- SESSION-5
- BOUCLE-7
