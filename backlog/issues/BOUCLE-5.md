---
id: BOUCLE-5
title: "A Ticket's page from its PhaseRun, the agent's « Ticket bloqué » and the Pilote's answer, on GitHub or Local"
epic: BOUCLE
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-4, UI-6, SOURCE-4]
adr: [0002, 0003, 0006, 0008]
risques: []
stories: [US-15, US-17]
screens: [ticket, ticket-bloque]
revue_visuelle: true
video: false
reprend: 86
---

## Context

US-15: the **Boucle** stops for the Pilote only on a visual review or a blocked **Ticket**, and goes on meanwhile with the Tickets that do not depend on it. An agent that cannot decide alone writes why (the `blocked.md` of the founder's `agent-loop`) and the Ticket waits in « À toi » (US-17). The Pilote follows a Ticket on its page (`/projets/:id/tickets/:number`): the **Étapes** of its PhaseRun as its pinned **Process** version lays them out (the refonte of the PRD made the Phase configurable: the track is no longer a fixed Code, Checks, Review, Merge), the **Review**'s Verdict, the checks, its **Changement de code**. The reason and the answer are content: on GitHub they are comments read and written by the browser with the Pilote's user token; on a Local Projet they are records of the Runner's `local.db`, read through the encrypted relay and written by the Runner; the server never holds them (ADR 0002, ADR 0003).

## Current state of the code

- `packages/contracts/src/composants/process-track.ts`: `ProcessTrack` (`cd-process-track`, steps `done | current | todo | off | halt`). `packages/contracts/src/api/decisions.ts`: `ticket-blocked` in `DECISION_KINDS`, `zDecision.params`; `apps/server/src/decisions/decisions.service.ts`: `raise`, `resolve`. `apps/server/src/github/github.client.ts`: `addLabels`, `removeLabel`. `apps/server/src/runners/runner-commands.service.ts`: `RunnerCommands.send` (422 `runner.offline`); `runner-dispatcher.ts`: `registerRunnerHandler`.
- `apps/web/src/api/github-token.ts` (the browser's user token, `POST /api/github/token`); no document reader nor `@tanstack/query-core`.
- Created by BOUCLE-4: the `review` and `merge` kinds, the Review posted through `miroir pr review`. Created by BOUCLE-3: the Code Skill with its « Modes » (`answer` empty), the `code` handler's modes. Created by BOUCLE-2: `LoopRecord` (`blockedCount`, `pilotIntervened`, `queuedAt`), the slot.
- Created by BOUCLE-1: `Ticket` (`source`, the product's labels readable, sealed title for Local), `CodeChange`, the check rows of a change's head, `GET /api/projects/:id/tickets/:number`, the `tickets` slice. Created by BOUCLE-9: the `checks` Verdict and its per-check rows (CI or Commandes).
- Created by PROCESS-4: `phase-run`, `step-run` events and slices, the pinned version of a PhaseRun; its rerun of an Étape in the same PhaseRun.
- Created by SOURCE-4: the web document reader with its GitHub fetcher (user token) and its Local fetcher (`artifact.read` through the relay: `ticket`, `change`, `diff`). Created by MIROIR-7: `miroir issue comment|edit` for both Sources; SOURCE-2: `apps/runner/internal/source/local/` (`local.db` comments).
- Created by UI-6: `ProcessTrack`, `CheckRow`; UI-2, UI-4, UI-5, UI-7: `Banner`, `Card`, `KeyValue`, `Button`, `TextField`, `Message`. Created by ATOI-1: « À toi » and `DecisionRow`.

## To do

- Skill `code` (and `review`), a section « Être bloqué »: when the agent cannot decide (the conventions file's rule), it writes `.crewdeck/blocked.md` in the conventions file's language and runs `crewdeck-runner etape report --blocked`; mode `answer`: read the comments after the last `<!-- crewdeck:blocked -->` one with `miroir issue view <n> --json comments` and go on from the branch.
- Runner: `etape report --blocked` posts `.crewdeck/blocked.md` with `miroir issue comment <n>`, starting with `<!-- crewdeck:blocked -->`, adds `needs-human` with `miroir issue edit <n> --add-label needs-human`, then reports `{ blocked: true, commentId }`; the Session ends.
- Protocol `packages/contracts/src/runner/comments.ts`: server → Runner `comment.write { requestId, projectId, target: { kind: 'issue' | 'change', number }, marker: 'answer' | 'visual-changes', sealed, removeLabel? }`; Runner → server `comment.written { requestId, commentId }` or `comment.failed { requestId, reason }`. The Runner opens `sealed` with the vault key (additional data `comment:<projectId>`), writes the comment into `local.db` with its marker, removes the label from the Ticket's file when asked. Shared fixtures valid in TypeScript and Go; `pnpm exec nx run contracts:generate`.
- Server `apps/server/src/loops/blocked.ts`, on a blocked report of an agent StepRun of a `ticket.ready` PhaseRun, in one transaction: StepRun `blocked` (PROCESS-4's state, added if absent), PhaseRun `waiting` (the slot is freed), `LoopRecord.blockedCount + 1`, `ticket-blocked` raised (label « #<n> <titre> » on GitHub, « #<n> » on Local, the page completing the title; `metaParts` [the Étape's name]; subject the Ticket; `params { commentId, stepRunId }`).
- `POST /api/projects/:id/tickets/:number/answer`, body `{ seq, commentId }` (GitHub: the browser posted the comment) or `{ seq, sealed }` (Local: the server sends `comment.write` with `removeLabel: 'needs-human'` and waits 10 s for `comment.written`, never storing nor logging `sealed`). The Ticket's open `ticket-blocked` is required (else 422 `ticket.not-blocked`); a body of the other Source → 422 `ticket.answer-wrong-source`; Runner offline → 422 `runner.offline`; no answer in 10 s → 422 `ticket.answer-timeout`. Then: on GitHub `removeLabel(needs-human)`; the Décision resolved (`outcome: answered`); `LoopRecord.pilotIntervened: true`; the blocked Étape rerun in `mode: answer` (same iteration), its LoopRecord `queuedAt` so it takes the slot first. 404 `ticket.not-found`; 409 stale.
- `needs-human` removed at the Source by hand on a blocked Ticket (a GitHub webhook, or SOURCE-3's `local.changed`) resolves the Décision (`outcome: unblocked-at-source`) and queues it the same way.
- Web:
  - Router `/projets/:id/tickets/:number`; `apps/web/src/views/ticket.ts` (pure); Composant `PageTicket` (`packages/contracts/src/composants/page-ticket.ts`, `packages/skin-passerelle/src/page-ticket.ts`, in `COMPOSANTS`), actions `openSession`, `openAtSource`, `answer` (`{ text }`); t() keys under `ticket.*`.
  - Header `#<n> <titre>`, the Projet, « Ouvrir la session » (the current or last Session of the Ticket's StepRuns, `?session=`).
  - « Avancement »: `ProcessTrack` from `ticketTrack(phaseRun, definition, stepRuns)` (pure, `apps/web/src/views/ticket-track.ts`): the Étapes of the PhaseRun's Phase in the pinned version, ordered by the arrows (ties by `col`, `row`), each `done | current | todo | halt` from its latest StepRun, metas « Claude Code · 24 min », « 4 sur 4 passés », « Codex · depuis 6 min », « par la Boucle, dès que la review passe », `halt` « bloqué depuis 4 min »; a `visual-review` Étape that does not apply to the Ticket is left out. Before admission: the active version's Étapes, all `todo`.
  - « Review du second agent »: per `review` Étape (its name as title when the Phase has more than one), StatusBadge (« en cours · <Moteur> », « ok », « changements »), then the review's text read by the document reader.
  - « Checks »: one `CheckRow` per check of the head (name, state, duration).
  - « Pull request »: KeyValue PR (« #212 », or « #12 · local »), Branche, Fichiers (« 7 modifiés · +214 −38 », read by the document reader), Vers; « Voir sur GitHub » only on GitHub. Before a change: « pas encore ouverte », Commits.
  - The Banner « Merge par la Boucle » (and « Ce Ticket n'a pas de revue visuelle » when no `visual-review` Étape applies).
  - Blocked (`ticket-bloque`): Banner `halt` « Ticket bloqué pendant <Étape> » with « La Boucle continue avec les Tickets qui ne dépendent pas de #<n> »; card « Ce que l'agent te demande » with the blocked comment as a `Message`, a `TextField` « Ta réponse » and « Répondre à l'agent »: on GitHub the browser posts the comment (`<!-- crewdeck:answer -->` + text) then calls `answer` with its id; on Local it seals the text (vault key, `comment:<projectId>`) and calls `answer` with `sealed`.
  - In « À toi », the `ticket-blocked` row's context is the first paragraph of the blocked comment, read by the document reader (keyed by Projet and comment id).
- Test scenarios `apps/server/src/testing/scenarios/ticket.ts` (`ticket`, `ticket-bloque`; a GitHub Projet, and a Local one through the fake Runner), the fake GitHub serving the comments, Playwright `apps/web/e2e/ticket.spec.ts`.

## Decisions already made

- Mockup: `ticket`, `ticket-bloque` (pages `design/screens/crewdeck/ticket.html`, `…/ticket-bloque.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The dictation button of « Ta réponse » is IDEE-4's; the banners « Modifié depuis sa prise » and « Fermé à sa Source » are SOURCE-6's.
- On GitHub the answer is a comment posted by the browser as the Pilote: the server learns only its id. On Local the server relays a ciphertext it cannot open: the Runner writes it.
- The track is read from the pinned definition, so a Ticket under review keeps the track of its version after an activation.
- The page reads state from the store; only content (review text, comments, file counts) goes through the document reader.

## Acceptance criteria

- [ ] An agent's blocked report posts the comment and `needs-human` through the Miroir, raises « #42 Connexion GitHub » in « À toi », and frees the slot for a Ticket that does not depend on #42.
- [ ] Answering on a GitHub Projet posts the comment, resolves the Décision, removes `needs-human`, and the Code Étape reruns in `answer` on its branch before any other admission.
- [ ] Answering on a Local Projet sends `comment.write` with a ciphertext, the Runner writes the comment and removes the label; the server's tables and logs never hold the text (test with a marker).
- [ ] Removing `needs-human` at the Source resolves the Décision and queues the Ticket.
- [ ] `answer`: 422 `ticket.not-blocked`, `ticket.answer-wrong-source`, `runner.offline`, `ticket.answer-timeout`; 409 stale; 404 for another Pilote's Ticket; 401 without a session; 400 with `fields` on a bad body.
- [ ] `ticketTrack` follows the pinned definition: a Process with a second Review shows five Étapes in arrow order; a Ticket without screens shows no Revue visuelle (unit tests).
- [ ] `/projets/:id/tickets/:number` matches `ticket` and `ticket-bloque` at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test server -- src/loops/blocked.spec.ts`
- `pnpm exec nx test web -- src/views/ticket-track.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- tickets`
- `pnpm exec nx test skin-passerelle -- src/page-ticket.spec.ts`
- `cd apps/runner && go test ./internal/source/local/ ./internal/protocol/`
- `pnpm exec nx e2e web -- ticket.spec.ts`
- `scripts/captures.sh ticket ticket-bloque`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing.

## Out of scope

- The visual review: BOUCLE-6. Limits and interruptions: BOUCLE-7.
- « Modifié depuis sa prise », « Fermé à sa Source »: SOURCE-6. A Retour exhausted: PROCESS-6.
- The document reader and its fetchers: SOURCE-4. Dictation: IDEE-4. The Session panel: SESSION-2.

## Dependencies

- BOUCLE-4.
- UI-6.
- SOURCE-4.
