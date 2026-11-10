---
id: BOUCLE-5
title: "A Ticket's page, the agent's « Ticket bloqué » and the Pilote's answer, while the Boucle goes on"
epic: BOUCLE
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-4, UI-6]
adr: [0002, 0003, 0006, 0008]
risques: []
stories: [US-15, US-17]
screens: [ticket, ticket-bloque]
revue_visuelle: true
video: false
---

## Context

US-15: the Boucle stops for the Pilote only on a visual review or a blocked **Ticket**, and goes on meanwhile with the Tickets that do not depend on it. An agent that cannot decide alone writes why (the `blocked.md` of the founder's `agent-loop`) and the Ticket waits in « À toi » (US-17). The Pilote follows a Ticket on its page (`/projets/:id/tickets/:number`): its steps, the second agent's review, the checks, its PR. The reason and the answer are content: they live on GitHub as comments, read and written by the browser with the Pilote's user token, never by the server (ADR 0002, ADR 0003).

## Current state of the code

- No code in the repository: only the docs and `design/`.
- Created by BOUCLE-4: `merge-gate.ts`, the `ticket-blocked` Décision after three review rounds or three red CI, `needs-human`, `loopStep: blocked`, `LoopRecord.blockedCount`; the Review posted as a `COMMENT` review.
- Created by BOUCLE-3: the Code Skill `apps/runner/skills/code/SKILL.md` and its « Modes » (`answer` empty).
- Created by BOUCLE-1: `Ticket`, `TicketCheck`, the `TicketCommentEvent` emitter, `GET /api/projects/:id/tickets/:number`.
- Created by UI-6: `ProcessTrack` with `ui-step` (`done|current|todo|off|halt`), `CheckRow`; UI-2, UI-4, UI-5, UI-7: `Banner`, `Card`, `KeyValue`, `Button`, `TextField`, `Message`.
- Created by CORE-4: `POST /api/github/token` (the browser's user token); ADR 0008: content from GitHub through `@tanstack/query-core`, keyed by repository and commit.
- Created by ATOI-1: `DecisionsService`, the « À toi » page and `DecisionRow`.

## To do

- Skill `code`, an « Être bloqué » section: when the agent cannot decide (the conventions file's rule), it writes `.crewdeck/blocked.md` in French and runs `crewdeck-runner etape report --blocked`; mode `answer`: read the comments after the last `<!-- crewdeck:blocked -->` comment of the issue and go on from the branch.
- Runner: `etape report --blocked` posts `.crewdeck/blocked.md` as an issue comment by `crewdeck[bot]` starting with `<!-- crewdeck:blocked -->`, then reports `{ blocked: true, commentId }`; the Session ends.
- Server `apps/server/src/loops/blocked.ts`: on that report, in one transaction: `loopStep: blocked`, label `needs-human` (through `GitHubClient`), `LoopRecord.blockedCount + 1`, `ticket-blocked` raised (label « #<n> <titre> » (the kind « Ticket bloqué » is rendered by ATOI-1), meta « <Projet> · Code », `subjectId` the Ticket, `blockedCommentId` kept on the Ticket).
- `POST /api/projects/:id/tickets/:number/answer` `{ seq, commentId }`: the Ticket must be `blocked` (else 422 `ticket.not-blocked`); removes `needs-human`, resolves the Décision (`outcome: answered`), `LoopRecord.pilotIntervened: true`, and makes the Ticket the first one the scheduler takes (a Code StepRun `mode: answer` on its branch). 404 `ticket.not-found`; 409 stale.
- The label `needs-human` removed by hand on GitHub on a `blocked` Ticket resolves the Décision (`outcome: unblocked-on-github`) and queues it the same way.
- Web:
  - `apps/web/src/github/comments.ts`: read an issue's comments, post a comment (with the user token, to the GitHub base URL of `GET /api/config`).
  - Router `/projets/:id/tickets/:number`; `apps/web/src/views/ticket.ts` (pure); Composant `PageTicket` (contract `packages/contracts/src/composants/page-ticket.ts`, `packages/skin-passerelle/src/page-ticket.ts`), actions `openSession`, `openOnGitHub`, `answer` (payload `{ text }`).
  - Header: `#<n> <titre>`, the Projet, « Ouvrir la session » (the current or last Session of the Ticket, `?session=`).
  - « Avancement »: `ProcessTrack` Code, Checks, Review, Merge, each `ui-step` from `loopStep`, the checks and the verdict (« Claude Code · 24 min », « 4 sur 4 passés », « Codex · depuis 6 min », « par la Boucle, dès que la review passe »; `halt` « bloqué depuis 4 min »).
  - « Review du second agent »: StatusBadge (« en cours · <Moteur> », « ok », « changements »), then the review's text read from GitHub by the browser.
  - « Checks »: one `CheckRow` per `TicketCheck` of the head (name, state, duration).
  - « Pull request »: KeyValue PR, Branche, Fichiers (« 7 modifiés · +214 −38 », read from GitHub by the browser), Vers; « Voir sur GitHub ». Before a PR: « pas encore ouverte », Commits.
  - The Banner « Merge par la Boucle » (and « Ce Ticket n'a pas de revue visuelle » when it has none).
  - Blocked (`ticket-bloque`): Banner `halt` « Ticket bloqué pendant le Code » with « La Boucle continue avec les Tickets qui ne dépendent pas de #<n> »; card « Ce que l'agent te demande » with the blocked comment as a `Message`, a `TextField` « Ta réponse » and « Répondre à l'agent »: the browser posts the comment (`<!-- crewdeck:answer -->` + text), then calls `answer` with its id.
  - In « À toi », the `ticket-blocked` row's context is the first paragraph of the blocked comment, read by the browser (`views/a-toi.ts` loader keyed by repository and comment id).
- Test scenarios `apps/server/src/testing/scenarios/ticket.ts` (`ticket`, `ticket-bloque`), the fake GitHub serving the comments, Playwright `apps/web/e2e/ticket.spec.ts`.

## Decisions already made

- Mockup: `ticket`, `ticket-bloque` (pages `design/screens/crewdeck/ticket.html`, `…/ticket-bloque.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The dictation button of « Ta réponse » is IDEE-4's, not built here.
- The answer is a GitHub comment posted by the browser as the Pilote: the server only learns its id. The next Code Session reads it.
- A Ticket blocked by BOUCLE-4's round limit is answered the same way: the comment is read in `answer` mode.
- The page reads the Ticket from the store; only the content (review text, comments, file counts) is fetched from GitHub.

## Acceptance criteria

- [ ] An agent's blocked report posts the comment, labels `needs-human`, raises « #42 Connexion GitHub » in « À toi » and frees the Boucle for a Ticket that does not depend on #42.
- [ ] Answering from the page posts the comment, resolves the Décision, removes `needs-human`, and the Ticket's next Code StepRun is `answer` on its branch, taken before other ready Tickets.
- [ ] Removing `needs-human` on GitHub resolves the Décision and queues the Ticket.
- [ ] `answer`: 422 `ticket.not-blocked`, 409 stale, 404 for another Pilote's Ticket, 401 without a session, 400 with `fields` without `commentId`.
- [ ] The blocked comment's text is never stored or logged by the server (test with a marker).
- [ ] `/projets/:id/tickets/:number` matches `ticket` and `ticket-bloque` at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test server -- src/loops/blocked.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- tickets`
- `pnpm exec nx test skin-passerelle -- src/page-ticket.spec.ts`
- `pnpm exec nx e2e web -- ticket.spec.ts`
- `scripts/captures.sh apps/web/e2e/ticket.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A migration (column `tickets.blocked_comment_id`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The visual review: BOUCLE-6. Limits and interruptions: BOUCLE-7.
- Dictation in « Ta réponse »: IDEE-4.
- The Session panel itself: SESSION-2.

## Dependencies

- BOUCLE-4
- UI-6
