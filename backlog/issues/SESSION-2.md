---
id: SESSION-2
title: "Session panel: read it as it streams, write, stop and resume, title and state only while the Runner is offline"
epic: SESSION
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [SESSION-1, UI-7]
adr: [0003, 0006, 0007, 0008]
risques: []
stories: [US-9, US-60]
screens: [session, session-arretee, session-runner-hors-ligne]
revue_visuelle: true
video: false
---

## Context

US-9: the Pilote drives an agent Session from the product: reads it as it streams, writes to it, stops and resumes it, without a terminal. US-60: while the Runner is offline a Session shows only its title and state, and it stays interrupted until the Pilote resumes it once the Runner is back. Every Étape runs in a Session (glossary), so this panel is opened from « À toi » (SESSION-3), the Conceptions (CONCEPTION-2), the Boucle (BOUCLE-3) and the Inventaire (PROJET-5).

## Current state of the code

- Only documents: the mockups `design/screens/crewdeck/session*.html`, `design/DESIGN.md` (« Session (US-9) » components, « Layout »: a session opens as a right panel at 1280, full screen at 390).
- Created by UI-7: the Composants `Session`, `Message`, `ToolCall`, `Question`, `PermissionRequest`, `Composer` (`packages/contracts/src/composants/`, `packages/skin-passerelle/src/`). Created by UI-3: the Cadre with its `panel` Emplacement and its Runner state. Created by UI-2: `Banner`, `Empty`, `StatusDot`.
- Created by RUNNER-9: `AgentSession` with its states and `POST /api/sessions/:id/stop`, `POST /api/sessions/:id/resume`, the `agent-session` events and store slice.
- Created by RUNNER-2: the Runner's presence (`runner` events, online / « hors ligne »).
- Created by SESSION-1: `apps/web/src/sessions/relay.ts` (`openSession`, `sendInput`, `closeSession`) and `session-buffer.ts`.

## To do

- **Router** (`apps/web/src/router.ts`): the query parameter `?session=<id>` on any page opens the panel over it (Cadre's `panel` Emplacement); closing removes the parameter; `apps/web/src/sessions/open.ts` exports `openSessionPanel(id)` for the other pages.
- **View** `apps/web/src/views/session.ts`, a pure function `(store, buffer, now) → SessionData` for the `Session` Composant:
  - `title` = the AgentSession's title; `meta` = « <Projet> · <Rôle> · <Moteur> », prefixed by « Runner hors ligne · » while offline;
  - `state` from the AgentSession (`active`, `waiting`, `stopped`, `interrupted`; `starting` shows as `active`, `ended` as `stopped` without the stop banner);
  - `items`: the buffer's events mapped to `Message` (agent, Pilote), `ToolCall` (tool, target, detail); questions and permission requests are SESSION-3's (shown as a plain agent `Message` until it lands);
  - a status line while active: « <Moteur> travaille · <durée depuis le dernier événement> »;
  - `resumeDisabled` while the Runner is offline;
  - `composer`: placeholder « Écrire à l'agent, ou dicter » (active, waiting), « Écrire pour reprendre la session » (stopped), disabled with « Disponible quand ton Runner est en ligne » (offline).
- **Actions** of the `Session` and `Composer` Composants, run by the core:
  - `send { text }`: encrypted through `sendInput` (`message` input); on a stopped Session, `POST /api/sessions/:id/resume` first, then the message;
  - `stop`: `POST /api/sessions/:id/stop { seq }`; `resume`: `POST /api/sessions/:id/resume { seq }`; an error's `message` shown as is;
  - `close`: removes `?session=`.
- **Stopped**: a neutral `Banner` « Session arrêtée par toi à <HH:MM> » with « Écris pour la reprendre là où elle s'est arrêtée, ou touche « Reprendre ». », from the AgentSession's `endedAt`.
- **Runner offline**: the halt `Banner` « Runner hors ligne » (« Ton Runner ne répond plus depuis <HH:MM>. Les sessions reprendront… », « Voir le Runner » → `/runner`), then an `Empty` « Conversation sur ton Runner » in place of the messages; the buffer is cleared; when the Runner is back the panel re-opens the relay and shows the replay.
- **Interruption** (US-60): the transitions are RUNNER-9's (`SessionsService.interruptAll` on the Runner's offline, `interrupted` kept after `hello` until `resume`); this ticket shows them in the panel and disables « Reprendre » while the Runner is offline.
- t() keys under `session.*` in `packages/sdk/src/i18n/fr.ts`.
- Test scenarios `apps/server/src/testing/scenarios/session.ts` (`session`, `session-arretee`, `session-runner-hors-ligne`): an AgentSession seeded, and the fake Runner (`apps/server/src/testing/fake-runner.ts`) extended to replay a recorded stream `packages/contracts/fixtures/runner/sessions/conception.jsonl` through SESSION-1's relay, encrypted with the TypeScript primitives.
- Playwright `apps/web/e2e/session.spec.ts` at 390 and 1280 px, axe.

## Decisions already made

- Mockup: `session`, `session-arretee`, `session-runner-hors-ligne` (pages `design/screens/crewdeck/session.html`, `…/session-arretee.html`, `…/session-runner-hors-ligne.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The page behind the panel in the mockups (the Conceptions) is CONCEPTION-1's; here the tests open the panel over `/a-toi`.
- The « Agrandir » button of the Session Composant is not shown at the MVP (`expandable: false` in its data).
- The microphone of the Composer is IDEE-4's; here it is hidden.
- The Runner's machine name in the offline banner is not shown (the « depuis <HH:MM> » time comes from the Runner's `lastSeenAt`).

## Acceptance criteria

- [ ] Opening `?session=<id>` shows the Session's replayed messages and tool calls, then the new ones as they come, without reloading.
- [ ] A message typed and sent appears as the Pilote's message and reaches the Runner; on a stopped Session it resumes it first.
- [ ] « Arrêter » stops the Session (state `stopped`, the stop banner with its time); « Reprendre » resumes it.
- [ ] When the Runner goes offline, every running Session becomes `interrupted`; the open panel shows the offline banner, the « Conversation sur ton Runner » empty state, a disabled composer and a disabled « Reprendre »; nothing of the content stays in the page.
- [ ] When the Runner is back the Session stays `interrupted`, « Reprendre » becomes enabled, and the conversation is replayed.
- [ ] Another Pilote's Session id gives the « introuvable » empty state, not a crash.
- [ ] Screens at 390 (full screen) and 1280 (right panel) match the mockups, axe without violations.

## Verification

- `pnpm exec nx test web -- src/views/session.spec.ts`
- `pnpm exec nx test server -- src/sessions/sessions.service.spec.ts`
- `pnpm exec nx test-integration server -- sessions`
- `pnpm exec nx e2e web -- session.spec.ts`; `scripts/captures.sh apps/web/e2e/session.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`.

## For prod

Nothing.

## Out of scope

- Questions and permission requests: SESSION-3. Dictation: IDEE-4.
- The lists that open a Session (Conceptions, Boucle): CONCEPTION-1, BOUCLE-3.

## Dependencies

- SESSION-1
- UI-7
