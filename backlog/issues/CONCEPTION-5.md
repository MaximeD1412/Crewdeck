---
id: CONCEPTION-5
title: "Maquettes Étape: the official visual-design Skill in code and its Contrat"
epic: CONCEPTION
type: feature
priority: P0
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-4]
adr: [0004, 0005]
risques: [IA-6]
stories: [US-11, US-48, US-83]
screens: []
revue_visuelle: false
video: false
---

## Context

When the PRD is approved and has screens, and the Étape optionnelle « Maquettes » is on for the Projet (US-83), the Rôle Conception draws the mockups in code, checked against the Maquettes Contrat (ADR 0005), opened as a design PR the Pilote reviews (CONCEPTION-6). The Skill is ported from the dotfiles `visual-design` skill, code mode (`MaximeD1412/dotfiles`, `agents/skills/visual-design/SKILL.md` and `REFERENCE.md`).

## Current state of the code

- Created by CONCEPTION-3: `apps/server/src/designs/documents.ts` (a document Étape's `ready`, voided, closed lifecycle and its `document-review` Décision), the PR verb with `--label`, the `{path}` variables of the Contrat interpreter.
- Created by CONCEPTION-4: approving the PRD starts the `mockups` Étape through `nextStep` (or skips it); `request-changes` starts a `--fix` run.
- Created by RUNNER-11 / RUNNER-12: Contrats, `check` functions, embedded Skills.
- No visual-design Skill, no `mockups` Contrat.

## To do

- **Skill** `apps/runner/skills/visual-design/` (`SKILL.md`, `REFERENCE.md`), ported in code mode only: the argument is the approved PRD's path; the inventory of the stories with screens, the screen list with its states in one closed round (`AskUserQuestion`), three visual directions only for a Projet without `design/DESIGN.md`, the library (`design/components.js`, `components.css`, `tokens.css` generated from `DESIGN.md`'s front matter), each screen and state at 390 and 1280 px with real copy, the full-page captures `design/screens/<group>/<screen>[-<state>]-<width>.png`, `design/screens.json` (`"tool": "code"`), a UX review by a fresh subagent when the Moteur has subagents; the design PR on branch `design/<slug>` into the integration branch, title `design: maquettes de <title>`, labels `conception` and `revue-visuelle`; `crewdeck-runner etape report` with `{ prNumber, branch, headSha, screenCount }`. Pencil, Stitch (`--explore`) and `--review` are dropped. `--fix <commentId>`: the comment's remarks by screen applied on the same branch, captures retaken.
  - Captures with `agent-browser`, as the dotfiles skill; at the Étape's start the Skill checks `agent-browser --version` and, when missing, ends with `crewdeck-runner etape report --failed "agent-browser manque sur la machine du Runner : npm i -g agent-browser"` (an « Étape échouée » with that reason).
  - The dotfiles `design tokens` and `design screens` checks are replaced by the Contrat below.
- **Contrat** `packages/contracts/src/contrats/mockups.ts`, version 1, ADR 0005's Maquettes row:
  - `mockups.design-md` (`file` `design/DESIGN.md`), « DESIGN.md existe »;
  - `mockups.index` (`json` `design/screens.json` against `zScreensIndex` in `packages/contracts/src/design/screens.ts`: `{ version: 1, tool: 'code', library?, screens: [{ id, title, prd, stories, html, captures: { 390, 1280 }, states: [{ id, title, html, captures }] }] }`), « screens.json est valide »;
  - `mockups.captures` (`check` `screens-captures`, `checks/screens_captures.go`): every screen and state has its PNG at 390 and 1280 px, each a PNG of that width, « Chaque écran et chaque état a sa capture à 390 et 1280 px »;
  - `mockups.stories` (`check` `screens-stories`): every story cited exists in `docs/product/`, « Chaque story citée existe dans le PRD »;
  - `mockups.pr` (`pr`: base the integration branch, branch `design/*`, label `conception`), « La PR des maquettes vise la branche d'intégration avec le label conception ».
  - Fixtures passing and failing per rule in `apps/runner/internal/contrat/testdata/mockups/`.
- **Server**: the `mockups` report fills the `DesignStep` (`figures.screenCount`) through `documents.ts`; the Décision reads « Conception à relire · Maquettes « <title> » », context « N écrans ». Nothing else.

## Decisions already made

- Code only at the MVP: the PRD's design tools (Penpot, Pencil, Figma) are US-85 (Lancement).
- `zScreensIndex` is the schema of this repository's own `design/screens.json` (read it for the shape); `plan-backlog`'s checks and CONCEPTION-9's Contrat read the same schema.
- `agent-browser` on the Pilote's machine is a requirement of this Étape only; the Runner itself needs no Node (ADR 0004).
- The Étape is skipped, not failed, when « Maquettes » is off or the PRD has no screen (`nextStep`, CONCEPTION-1).

## Acceptance criteria

- [ ] After the PRD's approval with mockups on, the `mockups` Étape starts with the Rôle Conception's Moteur; a passing report makes it `ready` and raises « Conception à relire · Maquettes « … » » with the screen count.
- [ ] A state without its 1280 px capture fails `mockups.captures`; a screen citing US-999 fails `mockups.stories`; an invalid `screens.json` fails `mockups.index` (Go fixtures).
- [ ] With « Maquettes » off for the Projet, approving the PRD goes straight to the Conception technique and the Maquettes Étape shows « désactivée pour ce Projet ».
- [ ] A machine without `agent-browser` ends the Étape « Étape échouée » with the install command in its reason.

## Verification

- `cd apps/runner && go test ./internal/contrat/... -run Mockups`
- `pnpm exec nx test contracts -- src/contrats/mockups.spec.ts src/design/screens.spec.ts`
- `pnpm exec nx test server -- src/designs/documents.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The mockups' review page and its approval: CONCEPTION-6.
- The cross review: it reads the PRD and the technical design only (CONCEPTION-8).

## Dependencies

- CONCEPTION-4.
