---
id: PROCESS-12
title: "The Commande Étape: its text sealed by the page, the command kind handler, command_runs, « Commande échouée » and its output read like a Session"
epic: PROCESS
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [RUNNER-18, PROCESS-9, PROCESS-4, SESSION-2]
adr: [0013, 0011, 0003]
risques: [SEC-11]
stories: [US-104]
screens: [session-commande, a-toi-process]
revue_visuelle: true
video: false
---

## Context

US-104: an Étape **Commande** runs a command of the **Pilote**'s choice on their **Runner**'s machine, in the **Projet**'s folder or the **Ticket**'s worktree (start a local server, run the tests, deploy), judged by its exit code and, when given, a health address; its output is read like a **Session**'s. ADR 0011 (« What the server reads of a Process ») and ADR 0013 (« A Commande ») set the guard of risk SEC-11: the text, its place (`where`) and its health address live in the version's sealed part, sealed by the browser under the vault key, opened only by the Runner; the server cannot forge a Commande the Runner would run. RUNNER-18 built the Runner's side (`command.run`, `command.verdict`, `command.output`); this ticket builds the rest: the form that seals, the `command` kind handler of the engine, the server's `command_runs`, the Décisions `command.failed` and `command.timeout`, and the output panel. PROCESS-13 (the « Livraison ») and BOUCLE-9 (the Checks' Commandes) reuse the runs service.

## Current state of the code

- `packages/contracts/src/api/decisions.ts`: `DECISION_KINDS` without any Commande kind; labels `decision.kind.<kind>` in `packages/sdk/src/i18n/fr.ts`.
- `apps/server/src/decisions/decisions.service.ts`: `raise(tx, input)` (one open per `(kind, subjectId)`), `resolve(tx, kind, subjectId, outcome)`, `assertOpen(tx, id)`.
- `apps/web/src/views/decisions/registry.ts`: `DecisionView { title?, context?, actions }`, `DecisionAction { id, label, primary?, needsRunner?, run }`, `registerDecisionView`; the kind's label is always `decision.kind.<kind>`.
- `apps/server/src/runners/runner-commands.service.ts` (`send` → 422 `runner.offline`, never queued), `runner-dispatcher.ts` (one handler per message type).
- `packages/contracts/src/runner/protocol.ts`: the two unions; no command message on develop.
- `apps/web/src/keys/vault.ts`: `Vault.sealItem(plaintext, aad)` and `openItem(item, aad)` (`SealedItem { key, ciphertext }`); Go `apps/runner/internal/keys/vault.go`.
- Composants `Session`, `ToolCall`, `CodeBlock`, `CheckRow`, `Banner`, `TextField`, `Radio`, `DecisionRow` in `packages/skin-passerelle/src/`.
- No `apps/server/src/process/`, no `apps/web/src/sessions/`, no `command_runs` table.
- Created by PROCESS-1: the catalogue's `command` kind (family `command`, capability `command`), the tools `{ kind: 'command', commandId }` and the definition's `commands: [{ id }]`. Created by PROCESS-3: `process_versions` and `process_drafts` with their opaque `sealed`, `PUT /api/projects/:id/process/draft` (`{ definition, sealed, revision }`, 409 `process.draft-stale`). Created by PROCESS-4: `apps/server/src/process/engine/` (`phase_runs`, `step_runs`, `StepKindHandler { kind, start(tx, run), onSignal(tx, run, signal) → StepResult | null, stop? }` in `engine/kinds/`, `Engine.signal`, `Engine.retry(tx, stepRunId)` (a new StepRun of the same Étape and iteration), `Engine.stop(tx, phaseRunId)`, the version pinned on the PhaseRun, events `phase-run`, `step-run`). Created by PROCESS-7 and PROCESS-9: the page `/projets/:id/process`, its Étape panel, « Attacher un Outil » with « Nouvelle Commande » adding a `commands[]` entry and its tool.
- Created by RUNNER-18: `packages/contracts/src/runner/command.ts` (`zSealedCommands` `{ commands: { [id]: { run, where: 'project' | 'worktree', healthUrl? } } }`; `command.run { runId, projectId, commandId, sealed: zSealedItem { key, ciphertext }, origin, integrationBranch, ref: { stepId, ticket, branch, sha } }`, `command.stop`, `command.started`, `command.verdict { runId, passed, exitCode, reason: exited | timeout | stopped | busy | sealed-invalid | place-unavailable | spawn-failed, durationMs }`; the output frames `command.open|close|replay|keys|output|error`), `apps/runner/internal/command/` (opening with `process:<projectId>`, the place, one run per Projet and Commande answering `busy`, the 30 min timeout, `~/.crewdeck/commands/<runId>.log`), `apps/server/src/commands/` (`CommandRuns.send(pilotId, run)`, `stop`, the output relay beside `SessionRelay` with its provider `COMMAND_RUN_OWNERS`), `apps/web/src/commands/output.ts` (`openCommandOutput`, `closeCommandOutput`), the fake Runner answering `command.run`. Created by RUNNER-19 (M3): the reasons `healthy` and `health-timeout`.
- Created by SESSION-1: the relay frames (`packages/contracts/src/runner/relay.ts`), `SessionRelay`, `apps/web/src/sessions/relay.ts`. Created by SESSION-2: the panel `?session=<id>`, `apps/web/src/views/session.ts`. Created by UI-9: `Session` state `failed` with `resume-label` and `resume-icon`.

## To do

- Turn on the « Commande » group of PROCESS-9's « Attacher un Outil » Menu (hidden there until this ticket: a draft cannot hold a Commande without its sealed part): choosing « Nouvelle Commande » there opens the form below, and the Commande joins the draft with its sealed part in one save (a `command` Étape added from PROCESS-8's catalogue has the Manque `capability.missing` until then).

- **Sealing in the page** `apps/web/src/process/sealed.ts`: `openSealed(projectId, sealed)` and `sealCommands(projectId, commands)` with `Vault.sealItem`/`openItem`, additional data `process:<projectId>`, the plaintext validated by `zSealedCommands`; a shared vector in `packages/contracts/fixtures/process/sealed-commands.json` that the Go side opens (`go test ./internal/command/ -run TestOpenSealedVector`). Decrypted parts cached per `(projectId, version | 'draft')` in memory only.
- **The « Commande » section** of the Étape panel (PROCESS-7), for a `command` Étape and for a Commande attached as an Outil: TextField « Ce qu'elle lance » (help « Elle tourne sur ton Runner ; ses secrets y restent. »), radios « Où » « Dans le dossier du Projet » (`project`) and « Dans le worktree du Ticket » (`worktree`), TextField « Adresse de santé, facultative » (help « Verdict : son code de sortie, puis cette adresse qui répond. »), the line « Sa sortie se lit comme une Session. Un échec t'attend dans « À toi ». ». Each change re-seals the whole part and saves the draft (500 ms after the last keystroke). The ToolChip of a Commande shows its decrypted text (cut at 40 characters), « Commande » until it is decrypted.
- **Prisma** `CommandRun` (`command_runs`): `id` (the `runId`), `pilotId`, `projectId`, `stepRunId`, `phaseRunId`, `processVersionId`, `commandId`, `ref` (jsonb, `command.run`'s: `stepId`, `ticket`, `branch`, `sha`), `state` (`queued | running | passed | failed`), `exitCode?`, `reason?` (the verdict's reasons, and `runner-offline`), `startedAt?`, `endedAt?`, `createdAt`; index `(pilotId, projectId, commandId, state)`. Figures only (ADR 0003).
- **Contracts** `packages/contracts/src/api/command-runs.ts`: `zCommandRun` (the fields above but `pilotId`), registered as the event resource `command-run` (`RESOURCES`, `registerEventPayload`); `StateContributor` key `commandRuns` (the runs not ended, and the last of each StepRun).
- **Server** `apps/server/src/commands/` (RUNNER-18's module):
  - `CommandRunsService.start(tx, { stepRun, commandId, ref })`: the row `queued` with its event, then after commit `CommandRuns.send` with the pinned version's `sealed`, the Projet's origin and integration branch; a `running` run of the same `(projectId, commandId)` keeps it `queued` until that one ends; `runner.offline` keeps it `queued` and it is sent on the Runner's `hello` (a `RunnerWaitingWork` provider `command-runs`). Used by this kind, PROCESS-13 and BOUCLE-9.
  - Runner handlers: `command.started` → `running`; `command.verdict` → `passed` or `failed` with `exitCode`, `reason`, `endedAt`, event, then the in-process hook `command-run.finished(run)`; `busy` puts the run back `queued` (a raced retry). The Runner going offline turns every `running` run into `failed` (`runner-offline`). `COMMAND_RUN_OWNERS` bound to `command_runs` (`owns(pilotId, runId)`).
  - `engine/kinds/command.ts`: `start` resolves the Entrées (a `code-change` Entrée gives `branch` and `sha`, the PhaseRun's item its `ticket` number), calls `CommandRunsService.start` and answers `running`; `command-run.finished` of a run of a `command` Étape calls `Engine.signal(tx, stepRunId, { run })`, whose `onSignal` answers `{ state: 'done', outputs }` (each Sortie `{ portId, type, id: runId, sha? }`) when it passed, else raises the Décision and answers `{ state: 'failed', failure: 'command.failed' | 'command.timeout' }`; `stop` sends `command.stop` for a running run.
  - **Décisions** `command.failed` and `command.timeout` (added to `DECISION_KINDS`; labels « Commande échouée », « Commande trop longue »): tone `halt`, icon `terminal`, `subjectType: 'command-run'`, `subjectId` the run's id, label « <nom de l'Étape> · <Projet> », meta « <Projet> · <Phase> », params `{ runId, commandId, exitCode, reason, processVersionId }`, link `/projets/:id?commande=<runId>`.
  - `POST /api/command-runs/:id/retry { seq }`: `Engine.retry` of its StepRun (a new StepRun of the same Étape and iteration, so a new run of the same Commande, ref and pinned version), the Décision resolved `outcome: retried`. `POST /api/command-runs/:id/stop { seq }`: `Engine.stop` of its PhaseRun, the Décision resolved `outcome: stopped`. Both: 404 `command-run.not-found` (or another Pilote's), 409 when the run changed after `seq`, 422 `command-run.not-failed` when the run did not fail or its StepRun was already retried or stopped; `retry` 422 `runner.offline`. French messages in `apps/server/src/errors/messages.ts`.
- **Reading the output** `apps/web/src/commands/`: `openCommandPanel(runId)` over RUNNER-18's `openCommandOutput`, and the query parameter `?commande=<runId>` opening the `Session` Composant in the Cadre's `panel` Emplacement; view `apps/web/src/views/command-run.ts` (pure): title « <nom de l'Étape> · <Projet> », meta « Commande · HH:MM », a `ToolCall` « Commande » with the decrypted text and « dans le dossier du Projet » or « dans le worktree du Ticket », a `CodeBlock` of the output, `CheckRow` « Code de sortie » and, with a health address, « Adresse de santé » (« <adresse> ne répond pas »), state `failed` with `resume-label` « Relancer » and `resume-icon` `refresh` (the `retry` command), and the halt `Banner` « Commande échouée » « Une Décision t'attend dans « À toi ». ». Runner offline: SESSION-2's offline state.
- **« À toi »**: `DecisionView` gains `kindLabel?: (decision) => string` (default `decision.kind.<kind>`); the view of both kinds: context « `<texte>` : code de sortie <n> », « …, et l'adresse de santé ne répond pas » or « … : arrêtée après 30 min », from the decrypted part (« Code de sortie <n> » while not decrypted); actions « Voir la sortie » (`?commande=`), « Relancer » (`needsRunner`), « Arrêter ».
- t() keys under `process.command.*` and `commandRun.*` in `packages/sdk/src/i18n/fr.ts`.
- Scenarios `apps/server/src/testing/scenarios/command.ts`: `session-commande` (a Local Projet « Recettes », a failed run, the fake Runner replaying a recorded output), and the Commande row of `a-toi-process` (created here, or extended if PROCESS-6 created it); the fake Runner answers `command.run` with a scripted verdict. Playwright `apps/web/e2e/command.spec.ts`.
- `docs/pilotage/risques.json`: SEC-11's first solution ticked.

## Decisions already made

- Mockup: `session-commande`, `a-toi-process` (pages `design/screens/crewdeck/session-commande.html`, `design/screens/crewdeck/a-toi-process.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The page behind the output panel in `session-commande` is the Projet's page (PROJET-3): here the tests open the panel over `/a-toi`. The mockup's « Lancement échoué » is the « Livraison » case, PROCESS-13's; this ticket's label is « Commande échouée ».
- The server never sees the text, the place nor the health address: not in a column, a log, a Décision nor an event. The place shown in the page comes from the decrypted part; the Runner ignores any place in the server's message (ADR 0011).
- An Appareil without the vault key (not trusted yet) shows the section's fields disabled with « Approuve d'abord cet Appareil pour lire et modifier les Commandes. ».
- A Commande attached to the Checks shows no « Où »: it is sealed `worktree` (BOUCLE-9). « Dans le worktree du Ticket » is disabled for an Étape with no Entrée `code-change`.
- A Commande whose text was never typed has no entry in the sealed part: the Runner refuses it, the run fails with `sealed-invalid` and the context reads « Commande sans texte dans cette version ». Not a Manque: `findGaps` never reads the sealed part.
- « Relancer » is PROCESS-4's `Engine.retry`: a new StepRun of the same iteration, so the Retour's count does not move. ATOI-2's « Étape échouée » is not raised for a `command` StepRun: its own Décision says more.
- `command.timeout` is its own kind (ADR 0013) with the same actions; a health address that does not answer within 120 s (RUNNER-19's `health-timeout`) is `command.failed`; `place-unavailable`, `spawn-failed` and RUNNER-20's `setup-failed` too, with their own context line (« Le worktree est pris par une Session », « Le shell n'a pas démarré »).
- « Arrêter » stops only the item (its PhaseRun); for a non-repeated Phase, the next PhaseRun waiting in order then starts (PROCESS-5).

## Acceptance criteria

- [ ] Typing « docker compose up -d », « Dans le dossier du Projet » and a health address saves a draft whose `sealed` opens in Go to exactly those values; the draft's `definition`, the database and the server's logs contain none of them (test with a marker string).
- [ ] A `command` Étape whose Entrées are fed creates a `command_runs` row and sends `command.run` with the pinned version's sealed part; a run of another version of the same Projet is sent with its own sealed part.
- [ ] A passing verdict passes the StepRun and feeds its Sorties with the run's id; a failing one raises « Commande échouée » with its exit code, a timeout « Commande trop longue », each with its event in the same transaction.
- [ ] A second run of the same Commande of the same Projet waits `queued` until the first ends; a run started while the Runner is offline is sent at its `hello`; the Runner going offline fails a running one with `runner-offline`.
- [ ] « Relancer » starts a new StepRun and run of the same Commande at the same SHA and resolves the Décision; « Arrêter » stops the PhaseRun; both answer 404 for another Pilote's run, 409 with an older `seq`, 422 `command-run.not-failed` on a passed run, and `retry` 422 `runner.offline`.
- [ ] « Voir la sortie » opens the panel with the replayed output, the decrypted command, « Code de sortie » 1 and « Adresse de santé » failed; « Relancer » in the panel reruns it.
- [ ] `session-commande` and `a-toi-process` match their mockups at 390 and 1280 px (Playwright against the fake Runner, axe without violations); the captures come from those tests.
- [ ] The sealed vector made by the page opens in Go, and one sealed in Go opens in the page.

## Verification

- `pnpm exec nx test web -- src/process/sealed.spec.ts`
- `pnpm exec nx test web -- src/views/command-run.spec.ts`
- `pnpm exec nx test server -- src/process/engine/kinds/command.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- command-runs`
- `cd apps/runner && go test ./internal/command/ -run TestOpenSealedVector`
- `pnpm exec nx e2e web -- command.spec.ts`; `scripts/captures.sh session-commande a-toi-process` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (table `command_runs`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The Runner's execution, `$SHELL -lc`, the `CREWDECK_*` variables, the log: RUNNER-18. Services kept running after a health address: RUNNER-19. « Préparer le worktree »: RUNNER-20.
- The « Livraison » Phase and its « Lancement échoué »: PROCESS-13. The Checks' Commandes: BOUCLE-9.
- Re-sealing a Modèle's Commandes: PROCESS-14. The Commande in the phone's list: PROCESS-11.

## Dependencies

- RUNNER-18
- PROCESS-9
- PROCESS-4
- SESSION-2
