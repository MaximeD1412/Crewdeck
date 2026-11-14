---
id: CONCEPTION-7
title: "Conception technique Étape: the technical-design kind handler, the official Skill and its Contrat"
epic: CONCEPTION
type: feature
priority: P1
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-4]
adr: [0004, 0005, 0011, 0012]
risques: [IA-6]
stories: [US-11, US-48]
screens: []
revue_visuelle: false
video: false
reprend: 92
---

## Context

After the PRD (and the mockups when the Process has them), the Conception technique Étape runs the technical design with the Pilote: what lets coding agents implement the Projet without asking (AGENTS.md, ADRs, glossary, risk register), checked against its Contrat (ADR 0005), on a change of the code's Source reviewed on CONCEPTION-4's page. The refonte (PRD #169, ADRs 0011 and 0012) makes it the `technical-design` **kind handler** of PROCESS-4's engine: it starts when its Entrées are fed (the approved PRD, and the approved Maquettes or Maquettes « absente » when the Phase has none or the PRD had no screen), its Rôle, Skill and Serveurs MCP are its Outils, and its change is written through `crewdeck-runner miroir pr create` for either Source (MIROIR-7). The Skill is ported from the dotfiles `technical-design` skill (`MaximeD1412/dotfiles`, `agents/skills/technical-design/SKILL.md` and `REFERENCE.md`).

## Current state of the code

- No `technical-design` Contrat, no technical-design Skill on develop; `STEP_IDS` has `technical-design`. This repository's own `AGENTS.md`, `docs/adr/`, `CONTEXT.md` and `docs/pilotage/risques.json` are the shape the Skill writes.
- Created by CONCEPTION-3: `documents.ts` (`design_documents`, the change's life on either Source), the remarks format and the `remarks-answered` check, the `{path}` variables, the settle mode of a document Skill.
- Created by CONCEPTION-4: the `approval` gate on a document and the review page `/conceptions/:id/relecture/:stepId` (for `technical-design`: AGENTS.md, then the ADRs, then `CONTEXT.md`), `approve`, `request-changes`.
- Created by PROCESS-4 / PROCESS-5: kind handlers, Entrées fed inside a Phase, an Entrée « absente ». By RUNNER-12: agent Sessions, embedded Skills. By MIROIR-7: `miroir pr create|comment` for both Sources.

## To do

- **Kind handler** `apps/server/src/process/engine/kinds/technical-design.ts` (kind `technical-design`), through `documents.ts`: `start` asks RUNNER-12's agent Session with its `role`, `skill` and `mcp` Outils and the Contrat `technical-design`, in a worktree of the integration branch at the latest approved document's SHA; arguments `{ prdPath, mockups: <change number> | 'absent', iteration }`, and on `iteration` > 1 the change to settle. On `passed` with `step.report { figures: { changeNumber, branch, headSha, adrCount } }`: the `design_documents` row (`type: 'technical-design'`), output `{ type: 'technical-design', id: changeNumber, sha: headSha }`, `design.upserted`; CONCEPTION-4's gate context reads « N ADR ».
- **Skill** `apps/runner/skills/technical-design/` (`SKILL.md`, `REFERENCE.md`), ported: arguments the PRD's path and the Maquettes (or « absente »: the Skill then designs without screens); the inventory of what is decided, closed question rounds with a recommendation (`AskUserQuestion`), AGENTS.md with its sections (The repo, Conventions with Language and From domain to code, Deciding alone, Checking, Delivering a ticket, Pilotage files), ADRs `docs/adr/NNNN-<slug>.md` with their status line, `CONTEXT.md`, `docs/pilotage/risques.json`, the design journal `docs/design-journal.md`. The change: branch `chore/technical-design` (or `chore/<topic>` for a feature) pushed to `origin`, `crewdeck-runner miroir pr create --base <integration> --title "docs(design): conception technique de <title>" --label conception`; `crewdeck-runner etape report`. Its own cross review removed (CONCEPTION-8 is an Étape of the Process); `design start`/`watch` replaced by `crewdeck-runner etape`. Settle mode as the other documents (read with `miroir pr view --json comments`, answer with `miroir pr comment`).
- **Contrat** `packages/contracts/src/contrats/technical-design.ts`, version 1, ADR 0005's row:
  - `technical-design.agents.sections` (`sections` of `AGENTS.md`: the six above, as `## ` headings in order; a French AGENTS.md keeps its names, so the rule accepts the list of `packages/contracts/src/contrats/agents-sections.ts` in either language), « AGENTS.md a ses sections »;
  - `technical-design.adr.status` (`pattern` on `docs/adr/*.md`: a line `> **Status:** <state>, <YYYY-MM-DD>.` or `> **Statut :** …`), « Chaque ADR a sa ligne de statut »;
  - `technical-design.risks` (`json` `docs/pilotage/risques.json` against `zRiskRegister` in `packages/contracts/src/pilotage/risks.ts`: `categories`, `statuts`, `risques[{ id, categorie, gravite, titre, statut, statutDepuis, solutions[{ texte, ref, fait }], tickets }]`), « risques.json est valide »;
  - `technical-design.glossary.identifiers` (`check` `glossary-identifiers`, `checks/glossary_identifiers.go`): every bold term of `CONTEXT.md`'s « Language » section is followed by its code identifier in backticks, « Chaque terme du glossaire a son identifiant de code »;
  - `technical-design.pr` (`pr`: base the integration branch, label `conception`, through the Miroir for either Source), « Le changement de conception technique vise la branche d'intégration avec le label conception »;
  - `technical-design.remarks.answered` (`check` `remarks-answered`, CONCEPTION-3's), « Chaque remarque est corrigée ou non retenue avec sa raison ».
  - Fixtures passing and failing per rule (this repository's own `AGENTS.md`, `docs/adr/` and `CONTEXT.md` copied into `testdata/technical-design/pass/`).

## Decisions already made

- The Contrat checks the shape the dotfiles skill writes (its REFERENCE.md), not the content's quality: the Revue croisée (CONCEPTION-8), when the Process has one, and the Pilote judge that.
- A Projet that already has a technical design (a feature Conception) changes AGENTS.md and adds ADRs on the same branch rules; the Contrat runs on the whole files, not only the diff.
- An absent Maquettes Entrée is an input of the Skill (« pas de maquettes »), never an error.
- A Local Projet gets the same files in its folder, merged by CONCEPTION-4's approval through SOURCE-5.

## Acceptance criteria

- [ ] After the approval of the Maquettes (or of the PRD on a Phase without Maquettes), the `technical-design` Étape starts with the Rôle of its Outil; a passing report passes it with its output at the head SHA, and the gate after it raises « Conception à relire · Conception technique « … » » with « N ADR ».
- [ ] With Maquettes « absente », the Session's arguments say `mockups: 'absent'` and the Étape runs.
- [ ] On a Local Projet the change is a local record and a branch of the folder; no GitHub call is made.
- [ ] An ADR without its status line fails `technical-design.adr.status`; a glossary term without its identifier fails `technical-design.glossary.identifiers`; this repository's own design passes every rule (Go fixtures).
- [ ] The review page shows AGENTS.md first, then the ADRs, then CONTEXT.md, for a gate on this Étape's Sortie.

## Verification

- `cd apps/runner && go test ./internal/contrat/... -run TechnicalDesign`
- `pnpm exec nx test contracts -- src/contrats/technical-design.spec.ts src/pilotage/risks.spec.ts`
- `pnpm exec nx test server -- src/process/engine/kinds/technical-design.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the Skill ships in the Runner's release).

## Out of scope

- The Revue croisée of the technical design: CONCEPTION-8.
- The console's Pilotage page drawn from `docs/pilotage/` (`setup-pilotage`): US-64 (Lancement).

## Dependencies

- CONCEPTION-4.
