---
id: SESSION-3
title: "Questions and permission requests of a Session, answered from the panel and raised in « À toi »"
epic: SESSION
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [SESSION-2, ATOI-1]
adr: [0003, 0004, 0007]
risques: []
stories: [US-9, US-17]
screens: [session-question, session-permission]
revue_visuelle: true
video: false
---

## Context

US-9: the Pilote answers an agent's questions and permission requests from the product. US-17: an agent's question or permission request waiting in a Session is a Décision in « À toi ». ADR 0004: Claude Code's permission requests come through `--permission-prompt-tool`, its `AskUserQuestion` is held by a `PreToolUse` hook, Codex's approvals through its app-server; the Runner normalises them (RUNNER-4). The question's text and the command are Session content: encrypted, the server only knows that a request waits (ADR 0003).

## Current state of the code

- Only documents: the mockups `design/screens/crewdeck/session-question.html`, `session-permission.html`, `a-toi.html` (rows « Question de l'agent », « Permission demandée »).
- Created by RUNNER-4/RUNNER-5/RUNNER-6: the normalised events `question { requestId, title, kicker?, options: [{ label, detail? }], multiSelect }` and `permission { requestId, tool, command }` and the adapters' way to answer them (`packages/contracts/src/runner/events.ts`).
- Created by SESSION-1: the relay, `sendInput`, `packages/contracts/src/runner/inputs.ts` (the `message` input).
- Created by SESSION-2: the panel and `apps/web/src/views/session.ts`.
- Created by ATOI-1: `DecisionsService.raise` / `resolve`, the kinds `agent-question` and `permission-requested`, `apps/web/src/views/decisions/registry.ts`.
- Created by UI-7: `Question` (with `Option`) and `PermissionRequest` Composants.

## To do

- **Inputs** (`packages/contracts/src/runner/inputs.ts`): `answer { requestId, optionIndexes: number[] } | { requestId, text }` and `permission { requestId, decision: 'allow' | 'allow-session' | 'deny' }`; the Runner hands them to the Moteur adapter (`Engine.Answer`) and ignores an answer to a request already answered.
- **Protocol** (`packages/contracts/src/runner/session.ts`, fixtures): Runner → server `session.waiting { sessionId, requestId, kind: 'question' | 'permission', seq }` (`seq` of the request in the Session's log) and `session.answered { sessionId, requestId }`.
- **Server** (`apps/server/src/sessions/requests.ts`), in one transaction each:
  - `session.waiting`: the AgentSession becomes `waiting`; `DecisionsService.raise` with kind `agent-question` (tone accent) or `permission-requested` (tone caution), `subjectType: 'session-request'`, `subjectId: requestId`, `label` = the Session's title, `meta` parts « <Projet> · session », `link` `?session=<sessionId>`, `params { sessionId, requestSeq }`;
  - `session.answered`: resolve with outcome `answered`; the Session goes back to `active` when no other request waits;
  - an `interrupted` or `stopped` Session keeps its open request Décisions.
- **Panel** (`apps/web/src/views/session.ts`): a pending `question` renders `Question` (kicker « Question n sur m » when the event gives it, options with their detail, « Répondre » enabled once an option is chosen; the Composer's placeholder becomes « Ou réponds avec tes mots »: its text is sent as `answer { text }`); a pending `permission` renders `PermissionRequest` (tool, command, « Autoriser », « Autoriser pour la session », « Refuser »). An answered request renders as a plain line « Tu as répondu : … » / « Autorisé » / « Refusé ».
- **« À toi »**: `apps/web/src/views/decisions/agent-question.ts` and `permission-requested.ts`: title « <Rôle> · <Session title> » for a permission and the Session title for a question, action « Répondre » (question) or « Ouvrir » (permission) → `openSessionPanel`; the context line is the question's title or « <tool> : <command> », read through the relay: `apps/web/src/sessions/peek.ts` opens the Session with `fromSeq = requestSeq`, keeps only that event and closes; Runner offline → « Ouvre la Session pour lire la question. » / « … la demande. ».
- t() keys `session.question.*`, `session.permission.*`, `decision.agentQuestion.*`, `decision.permissionRequested.*`.
- Scenarios `apps/server/src/testing/scenarios/session.ts` gain `session-question` and `session-permission` (recorded streams `packages/contracts/fixtures/runner/sessions/question.jsonl`, `permission.jsonl`); Playwright in `apps/web/e2e/session.spec.ts`.

## Decisions already made

- Mockup: `session-question`, `session-permission` (pages `design/screens/crewdeck/session-question.html`, `…/session-permission.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The server never sees the question nor the command: the Décision's label is the Session's title; « À toi » reads the text live from the Runner, never from a stored copy.
- One Décision per pending request (`subjectId = requestId`); an answer from any surface (panel, another tab) resolves it through the Runner's `session.answered`.
- « Autoriser pour la session » is the Moteur's own « always allow » for that tool in that Session (Claude Code's `updatedPermissions` of the prompt tool's answer, Codex's `approved_for_session`); nothing is remembered by Crewdeck.
- The Rôles Code and Review run without prompts (ADR 0004): only the Sessions the Pilote drives raise these Décisions.

## Acceptance criteria

- [ ] A question of the agent shows in the panel with its options; choosing one and « Répondre » sends it, the agent goes on, the Décision leaves « À toi ».
- [ ] Typing a free answer in the composer while a question waits answers it.
- [ ] A permission request shows its tool and command; « Autoriser », « Autoriser pour la session » and « Refuser » each reach the Moteur.
- [ ] A waiting request is a Décision « Question de l'agent » or « Permission demandée » in « À toi », whose context shows the text read from the Runner, and « Ouvre la Session… » while it is offline.
- [ ] The Décision's row in the database holds no question text and no command (test on the stored row).
- [ ] Answering an already answered request does nothing and the panel shows the answer given.
- [ ] Screens at 390 and 1280 match the mockups, axe without violations.

## Verification

- `pnpm exec nx test server -- src/sessions/requests.spec.ts`
- `pnpm exec nx test-integration server -- sessions`
- `pnpm exec nx test web -- src/views/session.spec.ts`
- `cd apps/runner && go test ./internal/session/ -run TestAnswer`
- `pnpm exec nx e2e web -- session.spec.ts`; `scripts/captures.sh apps/web/e2e/session.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

Nothing.

## Out of scope

- The push for these Décisions: ATOI-4's generic rule. The Boucle's AgentRow « attend ta permission »: BOUCLE-3.

## Dependencies

- SESSION-2
- ATOI-1
