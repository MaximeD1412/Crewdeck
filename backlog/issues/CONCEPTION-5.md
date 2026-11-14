---
id: CONCEPTION-5
title: "Maquettes Étape: the mockups kind handler, the official visual-design Skill in code and its Contrat"
epic: CONCEPTION
type: feature
priority: P0
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-4]
adr: [0004, 0005, 0011, 0012]
risques: [IA-6]
stories: [US-11, US-48]
screens: []
revue_visuelle: false
video: false
reprend: 90
---

## Context

After the PRD is approved, the Maquettes Étape draws the mockups in code, checked against the Maquettes Contrat (ADR 0005), on a change of the code's Source the Pilote reviews (CONCEPTION-6). The refonte (PRD #169, ADRs 0011 and 0012) removes the Étapes optionnelles (US-83 is removed): the Étape runs because it is in the Projet's Process, never because of a setting; a Pilote who does not want mockups removes it from the canvas. It becomes the `mockups` **kind handler** of PROCESS-4's engine, started when its Entrée (the approved PRD) is fed, its Rôle, Skill and Serveurs MCP being its Outils (Stitch or Figma reach it as Serveurs MCP, RUNNER-17), its change written through `crewdeck-runner miroir pr create` for either Source (MIROIR-7). The Skill is ported from the dotfiles `visual-design` skill, code mode (`MaximeD1412/dotfiles`, `agents/skills/visual-design/SKILL.md` and `REFERENCE.md`).

## Current state of the code

- No `mockups` Contrat, no visual-design Skill on develop; `STEP_IDS` has `mockups`.
- Created by CONCEPTION-3: `apps/server/src/designs/documents.ts` (the document record `design_documents`, the change's life on either Source, the signals `document-voided` and `document-refreshed`), the remarks format and the `remarks-answered` check, the `{path}` variables of the Contrat interpreter, the settle mode of a document Skill.
- Created by CONCEPTION-4: the `approval` gate on a document, its merge on GitHub or Local, the Verdict « changements » taking a Retour.
- Created by PROCESS-4 / PROCESS-5: kind handlers, Entrées fed inside a Phase, an Entrée « absente ». By RUNNER-12: agent Sessions, embedded Skills. By RUNNER-17: the Étape's Serveurs MCP in its Session. By MIROIR-7: `miroir pr create|comment` for both Sources.

## To do

- **Kind handler** `apps/server/src/process/engine/kinds/mockups.ts` (kind `mockups`), through `documents.ts`:
  - `start(tx, stepRun)`: when the PRD of its Entrée has no screen (`hasScreens: false` in the PRD's `design_documents.figures`), the StepRun passes at once without a Session and its Sortie is marked absent (`{ portId, type: 'mockups', absent: true }`), so that the Étapes it feeds get the Entrée « absente » (ADR 0011) and the gate after it passes without a Décision (CONCEPTION-6). Otherwise RUNNER-12's agent Session with its `role`, `skill` and `mcp` Outils and the Contrat `mockups`, in a worktree of the integration branch at the PRD's approved SHA; arguments `{ prdPath, iteration }`, and on `iteration` > 1 the change to settle.
  - On `passed` with `step.report { figures: { changeNumber, branch, headSha, screenCount } }`: the `design_documents` row (`type: 'mockups'`), output `{ type: 'mockups', id: changeNumber, sha: headSha }`, `design.upserted`; CONCEPTION-4's gate context reads « N écrans ».
- **Skill** `apps/runner/skills/visual-design/` (`SKILL.md`, `REFERENCE.md`), ported in code mode only: the argument is the approved PRD's path; the inventory of the stories with screens, the screen list with its states in one closed round (`AskUserQuestion`), three visual directions only for a Projet without `design/DESIGN.md`, the library (`design/components.js`, `components.css`, `tokens.css` generated from `DESIGN.md`'s front matter), each screen and state at 390 and 1280 px with real copy, the full-page captures `design/screens/<group>/<screen>[-<state>]-<width>.png`, `design/screens.json` (`"tool": "code"`), a UX review by a fresh subagent when the Moteur has subagents; the Serveurs MCP of the Étape used when present, never required. The change: branch `design/<slug>` pushed to `origin`, `crewdeck-runner miroir pr create --base <integration> --head design/<slug> --title "design: maquettes de <title>" --label conception --label revue-visuelle`; `crewdeck-runner etape report`. Pencil, Stitch `--explore` and `--review` are dropped. Settle mode: the remarks by screen (`**R<n>** · Sur <screen id>`) applied on the same branch, captures retaken, answers posted with `miroir pr comment`.
  - Captures with `agent-browser`, as the dotfiles skill; at the Étape's start the Skill checks `agent-browser --version` and, when missing, ends with `crewdeck-runner etape report --failed "agent-browser manque sur la machine du Runner : npm i -g agent-browser"` (an « Étape échouée » with that reason).
- **Contrat** `packages/contracts/src/contrats/mockups.ts`, version 1, ADR 0005's Maquettes row:
  - `mockups.design-md` (`file` `design/DESIGN.md`), « DESIGN.md existe »;
  - `mockups.index` (`json` `design/screens.json` against `zScreensIndex` in `packages/contracts/src/design/screens.ts`: `{ version: 1, tool: 'code', library?, screens: [{ id, title, prd, stories, html, captures: { 390, 1280 }, states: [{ id, title, html, captures }] }] }`), « screens.json est valide »;
  - `mockups.captures` (`check` `screens-captures`, `checks/screens_captures.go`): every screen and state has its PNG at 390 and 1280 px, each a PNG of that width, « Chaque écran et chaque état a sa capture à 390 et 1280 px »;
  - `mockups.stories` (`check` `screens-stories`): every story cited exists in `docs/product/`, « Chaque story citée existe dans le PRD »;
  - `mockups.pr` (`pr`: base the integration branch, branch `design/*`, label `conception`, through the Miroir for either Source), « Le changement des maquettes vise la branche d'intégration avec le label conception »;
  - `mockups.remarks.answered` (`check` `remarks-answered`, CONCEPTION-3's), « Chaque remarque est corrigée ou non retenue avec sa raison ».
  - Fixtures passing and failing per rule in `apps/runner/internal/contrat/testdata/mockups/`.

## Decisions already made

- Code only at the MVP: the PRD's design tools (Penpot, Pencil, Figma) as Étapes of their own are US-85 (Lancement); a design tool reaches this Étape as a Serveur MCP.
- `zScreensIndex` is the schema of this repository's own `design/screens.json` (read it for the shape); CONCEPTION-6's page and CONCEPTION-9's Contrat read the same schema.
- `agent-browser` on the Pilote's machine is a requirement of this Étape only; the Runner itself needs no Node (ADR 0004).
- A PRD without a screen gives Maquettes « absente », not a failure: the Process stays the same, and the Conception technique and the Découpage read the Entrée as absent.
- No setting turns the Étape off: whether it runs is whether the Projet's pinned version has it.

## Acceptance criteria

- [ ] After the PRD's approval on « Process Crewdeck », the `mockups` Étape starts with the Rôle of its Outil; a passing report passes it with its output at the head SHA and the gate « Revue des maquettes » receives it with « N écrans ».
- [ ] On a Local Projet the change is a local record and a branch of the folder; no GitHub call is made.
- [ ] A PRD with no screen passes the Étape at once, with no Session, its Sortie absent.
- [ ] A Conception whose pinned version has no Maquettes Étape goes from the PRD's approval to the Conception technique (engine test on a fixture definition).
- [ ] A state without its 1280 px capture fails `mockups.captures`; a screen citing US-999 fails `mockups.stories`; an invalid `screens.json` fails `mockups.index` (Go fixtures).
- [ ] A machine without `agent-browser` ends the Étape « Étape échouée » with the install command in its reason.

## Verification

- `cd apps/runner && go test ./internal/contrat/... -run Mockups`
- `pnpm exec nx test contracts -- src/contrats/mockups.spec.ts src/design/screens.spec.ts`
- `pnpm exec nx test server -- src/process/engine/kinds/mockups.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the Skill ships in the Runner's release).

## Out of scope

- The mockups' review page and its approval: CONCEPTION-6.
- Declaring and mounting Serveurs MCP: RUNNER-16, RUNNER-17.
- A Review of the mockups by an agent on another Rôle: an Étape the Pilote adds from the catalogue (US-93), not this ticket.

## Dependencies

- CONCEPTION-4.
