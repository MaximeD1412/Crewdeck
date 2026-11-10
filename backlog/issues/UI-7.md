---
id: UI-7
title: "Session Composants: Session, Message, ToolCall, Question, PermissionRequest, Composer"
epic: UI
type: feature
priority: P1
size: M
milestone: M1 Socle
blocked_by: [UI-2]
adr: [0006, 0007]
risques: []
stories: [US-23, US-9]
screens: [composants]
revue_visuelle: true
video: false
---

## Context

US-9: the Pilote drives an agent Session from the product (read it as it streams, write to it, answer its questions and permission requests, stop and resume it). US-23: an agent session is one of the blocks a Skin may replace. `design/DESIGN.md` « Session (US-9) » lists the Composants; ADR 0007: dictation is the browser's Web Speech API, its button hidden where the API is missing. This ticket builds the Composants only; SESSION-2 and SESSION-3 build the panel's behaviour with the relay, IDEE-4 wires the dictation.

## Current state of the code

- Created by UI-1: `defineComposant`, `PasserelleElement`, `emitAction`, `t()`.
- Created by UI-2: Icon, IconButton, Button, StatusBadge, the library page and its generated examples test.
- `design/components.js` (`ui-session`, `ui-message`, `ui-tool-call`, `ui-question` / `ui-option`, `ui-permission-request`, `ui-composer`) and `design/screens/crewdeck/session*.html`: the drawn reference.

## To do

- Declarations in `packages/contracts/src/composants/`, implementations in `packages/skin-passerelle/src/`, category `partie`, each with examples:
  - **Session** `cd-session`: data `{ id: zId, title, meta, state: 'active' | 'waiting' | 'stopped' | 'interrupted', resumeDisabledReason: string | null }`; slots `default` (the messages, tool calls, question, permission request, in order), `composer`; actions `stop {}`, `resume {}` (« Reprendre », disabled with its reason when `resumeDisabledReason` is set, e.g. the Runner offline), `close {}` (« Fermer » at 1280, the back arrow « Retour » at 390), `expand {}` (« Agrandir », 1280 only). « Arrêter » (secondary, icon `stop`) while `active` or `waiting`, « Reprendre » (icon `play`) while `stopped` or `interrupted`. The messages area is a log (`role="log"`, `aria-live="polite"`) that keeps to the bottom while the Pilote has not scrolled up.
  - **Message** `cd-message`: data `{ from: 'agent' | 'pilote', text, at: zInstant }`; the agent's text rendered as Markdown with `markdown-it` (`html: false`, `linkify: true`, links `rel="noopener noreferrer"` `target="_blank"`), the Pilote's as plain text.
  - **ToolCall** `cd-tool-call`: data `{ tool, target: string | null, detail: string | null }`; mono.
  - **Question** `cd-question`: data `{ id, kicker: string | null, title, options: { id, label, detail: string | null, selected: boolean }[], multiple: boolean }`; action `answer { questionId, optionIds: string[] }` (« Répondre », primary); radios, or checkboxes when `multiple`; the free answer goes through the Composer (« Ou réponds avec tes mots »).
  - **PermissionRequest** `cd-permission-request`: data `{ id, tool, command }`; actions `allow { id }` (« Autoriser », primary), `allowForSession { id }` (« Autoriser pour la session »), `deny { id }` (« Refuser », ghost); the title `permissionRequest.title` « {tool} demande ta permission » and the command in a mono block.
  - **Composer** `cd-composer`: data `{ placeholder, hint: string | null, state: 'idle' | 'dictating' | 'disabled', value: string, dictation: boolean }`; actions `send { text }` (Enter, or the `send` button; Shift+Enter a new line; nothing sent when empty), `dictate {}` and `stopDictation {}` (the `mic` / `stop` button, present only when `dictation` is true); `value` lets the core put a transcript in the field for the Pilote to correct before sending (US-57); default hint `composer.hint` « Entrée envoie · Maj+Entrée va à la ligne ».
- Examples reproducing the Session mockups: active with messages and tool calls, waiting on a question (« Question 1 sur 3 », three options, the Reco one selected), waiting on a permission (`Bash`, `git push origin design/agenda-partage`), stopped, interrupted with « Reprendre » disabled (« Runner hors ligne »), a Composer dictating.
- `t()` keys `composants.<Name>.*`, `session.*`, `question.*`, `permissionRequest.*`, `composer.*` with the mockup's labels (« Arrêter », « Reprendre », « Fermer », « Agrandir », « Retour », « Répondre », « Autoriser », « Autoriser pour la session », « Refuser », « Envoyer », « Dicter », « Arrêter la dictée »).
- Playwright `apps/web/e2e/composants-session.spec.ts`: the library page for each at 390 and 1280 px, keyboard (Enter sends, Shift+Enter breaks a line, arrows in the options), axe.

## Decisions already made

- Mockup: `composants` (page `design/screens/crewdeck/composants.html`; captures `design/screens/crewdeck/composants-390.png`, `…-1280.png`), and the Session as drawn in `design/screens/crewdeck/session.html`, `session-question.html`, `session-permission.html`, `session-arretee.html`, `session-runner-hors-ligne.html`. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- An agent's Markdown never renders raw HTML (`html: false`): the text comes from a model and may contain anything.
- The Composer does not run the speech recognition: it asks (`dictate`) and shows what the core puts in `value`; IDEE-4 owns the Web Speech API.
- Answering a permission or a question is not an Action sensible (PRD's list), no confirmation.

## Acceptance criteria

- [ ] Every example of the six Composants renders (UI-2's generated test); each action emits a `cd-action` whose payload matches its schema.
- [ ] Session shows « Arrêter » while active or waiting and « Reprendre » while stopped or interrupted, disabled with its reason when `resumeDisabledReason` is set.
- [ ] Message renders `**gras**` and a link from the agent, and shows `<script>` as text.
- [ ] Composer: Enter emits `send` with the text and clears it, Shift+Enter inserts a line, an empty field sends nothing; the mic button is absent when `dictation` is false.
- [ ] Question emits `answer` with the selected option ids; PermissionRequest's three buttons emit their action with the request's id.
- [ ] axe without violations on the library page at 390 and 1280 px.

## Verification

- `pnpm exec nx test skin-passerelle -- src/session.spec.ts src/composer.spec.ts`
- `pnpm exec nx test skin-passerelle`
- `pnpm exec nx e2e web -- composants-session.spec.ts`
- `scripts/captures.sh apps/web/e2e/composants-session.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The Session panel, its relay and its commands: SESSION-1, SESSION-2. Answering questions and permissions through the Runner: SESSION-3.
- The speech recognition: IDEE-4.

## Dependencies

- UI-2.
