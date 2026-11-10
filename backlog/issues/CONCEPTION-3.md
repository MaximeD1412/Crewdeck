---
id: CONCEPTION-3
title: "PRD Étape: the official product-design Skill, its Contrat, the design PR and « Conception à relire »"
epic: CONCEPTION
type: feature
priority: P0
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-1]
adr: [0002, 0004, 0005, 0007]
risques: [IA-6]
stories: [US-8, US-11, US-48]
screens: []
revue_visuelle: false
video: false
---

## Context

The first Étape of a Conception: an agent of the Rôle Conception writes the PRD with the Pilote in a Session (US-8), checked against the PRD Contrat (ADR 0005, US-48), opened as a design PR labelled `conception`; once it passes, « À toi » asks the Pilote to review it (US-11, ADR 0002: approving is merging that PR). The Skill is ported from the dotfiles `product-design` skill (`MaximeD1412/dotfiles`, `agents/skills/product-design/SKILL.md` and `REFERENCE.md`). This ticket also writes the lifecycle every document of a Conception shares (ready, voided by a push, closed), reused by CONCEPTION-5, CONCEPTION-7 and CONCEPTION-9.

## Current state of the code

- Created by CONCEPTION-1: `Design`, `DesignStep` (`apps/server/src/designs/`), the `prd` Étape started as a `StepRun` (Rôle `design`) with the Idée's id as argument, `designs/step-runs.listener.ts`.
- Created by RUNNER-11 / RUNNER-12: the Contrat declarations and their Go interpreter (rule kinds `file`, `sections`, `pattern`, `front-matter`, `json`, `pr`, `check`), `step.report` and `step.verdict`, the embedded Skills `apps/runner/skills/`, `crewdeck-runner etape start|report|ask`.
- Created by RUNNER-10: the Session's GitHub token (contents, issues, pull requests).
- Created by PROJET-1: the webhook dispatch (`pull_request` events per repository); by ATOI-1: `DecisionsService`, kind `document-review`.
- Created by BOUCLE-3 (Code Étape): the Runner's PR opening from a Session (`apps/runner/internal/github/`).
- No PRD Skill, no `prd` Contrat.

## To do

- **Skill** `apps/runner/skills/product-design/` (`SKILL.md`, `REFERENCE.md`), ported from the dotfiles skill for a Conception of an existing Projet:
  - argument: the Idée's id; the Runner writes `.crewdeck/context.json` (the Idée's text and analysis decrypted, the Projet, the merged Idées' texts pointing to it) before the Session starts;
  - inventory of the repository, closed question rounds with a recommendation through `AskUserQuestion` (answered in the Session panel, SESSION-3), the PRD written as decisions are made: `docs/product/prd.md` when the repository has none, else `docs/product/features/<slug>.md`; stories `- **US-<n>** (MVP|next|later) As a …` with the next free numbers across `docs/product/`; `CONTEXT.md` terms;
  - its own cross review step is removed (it is CONCEPTION-8's Étape); the `ideas` and `design` commands are replaced by `crewdeck-runner etape`;
  - the design PR: branch `docs/product-<slug>` into the integration branch, title `docs(product): <title>`, label `conception`, opened with the Runner's PR verb (BOUCLE-3's; add a `--label` option if it has none); then `crewdeck-runner etape report` with `{ prNumber, branch, path, headSha, hasScreens, storyCount, openQuestions }`.
  - `--fix <commentId>` mode (« Demander des changements », CONCEPTION-4): the Runner puts the comment's body in the context (read with the Session's token); the Skill fixes the PRD on the same branch, pushes, reports again.
- **Contrat** `packages/contracts/src/contrats/prd.ts`, version 1, the rules of ADR 0005's PRD row, with `{path}` taken from the report (variable substitution in `apps/runner/internal/contrat/vars.go` if RUNNER-11's interpreter has none):
  - `prd.file` (`file` `{path}`), « Le PRD est dans docs/product/ »;
  - `prd.sections` (`sections`): Problem, Users, Journeys, Scope, Success criteria, Constraints, Open questions (and Principles for `prd.md`), « Le PRD a ses sections »;
  - `prd.stories.shape` (`pattern` on `- **US-<n>**` lines, unique capture), « Chaque story a un identifiant unique »;
  - `prd.stories.stable` (`check` `prd-stories-stable`, `checks/prd_stories_stable.go`): no story id of the base branch's `docs/product/` removed (other than crossed out) or reused, « Aucune story existante n'est supprimée ni réutilisée »;
  - `prd.stories.scoped` (`check` `prd-stories-scoped`): every story has a tag and appears in « Scope » (by id or range), « Chaque story est dans le Scope »;
  - `prd.glossary` (`file` `CONTEXT.md`), « Le glossaire CONTEXT.md existe »;
  - `prd.pr` (`pr`: base = the integration branch, branch `docs/product-*`, label `conception`), « La PR de conception vise la branche d'intégration avec le label conception ».
  - One passing and one failing fixture per rule (`apps/runner/internal/contrat/testdata/prd/`).
- **Server** `apps/server/src/designs/documents.ts`, the lifecycle of a document Étape (`prd`, `mockups`, `technical-design`, `split`):
  - on the `passed` verdict of its `StepRun` with the report: the `DesignStep` gets `prNumber`, `branch`, `headSha`, `verdictSha = headSha`, `figures`, state `ready`; `Design.prdPath`, `slug` and `title` (the PR's title without `docs(product): `) are set from the PRD's report; then `documentReady(tx, design, kind)`, which raises `document-review` (subject the `DesignStep`, label « PRD « <title> » (the kind « Conception à relire » is rendered by ATOI-1) », meta « <Projet> · Conception », context from the figures « 12 stories, 2 questions ouvertes »). CONCEPTION-8 inserts the cross review before this raise.
  - `pull_request` webhooks of a PR held by a `DesignStep` (`designs/pull-requests.listener.ts`): `synchronize` with a head ≠ `verdictSha` voids the verdict (ADR 0002): state `checking`, the open `document-review` resolved (outcome `voided`), and a re-check of the Contrat at the new head sent to the Runner (`step.check { stepRunId, headSha }` in `packages/contracts/src/runner/step.ts`, added with its Runner handler if RUNNER-11 did not); its verdict brings the Étape back to `ready` (Décision raised again) or `incomplete`. `edited` updates the title. `closed` without merge: state `todo`, Décision resolved (outcome `closed`), the Étape can be started again from the Conception page. `closed` merged is CONCEPTION-4's.
  - Each change writes `design.upserted` in its transaction.
- Tests: Go tests of the rules and checks; server tests of `documents.ts` and the listener with signed fixture payloads (PROJET-1's helper) and the fake Runner.

## Decisions already made

- The PRD's path is the Skill's choice by the dotfiles rule (`prd.md` for a repository without one, else a feature file); the Contrat reads it from the report.
- The server never reads the PRD (ADR 0002): it knows the path, the figures and the PR's metadata; the Runner checks the content.
- A push to the design PR after its verdict voids the verdict and re-checks the Contrat at the new head; approving is always bound to `verdictSha` (CONCEPTION-4).
- The question rounds go through the Moteur's own question tool held by the Runner (ADR 0004), so they reach « À toi » as « Question de l'agent » (SESSION-3).
- `prd.stories.stable` compares with the base branch fetched in the worktree (`git show origin/<integration>:<file>`), so a feature PRD never renumbers the product's stories.

## Acceptance criteria

- [ ] With the fake Runner replaying a PRD Session, a `passed` verdict makes the `prd` Étape `ready` with its PR number, the Conception's title and path set, and « Conception à relire · PRD « Agenda partagé » » in « À toi » with « 12 stories, 2 questions ouvertes ».
- [ ] A PRD whose story US-3 of the base branch disappeared fails `prd.stories.stable`; a story out of « Scope » fails `prd.stories.scoped`; a PR without the label fails `prd.pr` (Go fixtures).
- [ ] A push to the design PR after the verdict resolves the Décision, sends `step.check` at the new head, and a passing re-check raises it again.
- [ ] The design PR closed without merge brings the Étape back to `todo` and resolves the Décision.
- [ ] Every Étape change and its event are written in one transaction.
- [ ] No server log line contains a file path's content or a PR body (only ids, numbers, SHAs).

## Verification

- `cd apps/runner && go test ./internal/contrat/... -run Prd`
- `pnpm exec nx test contracts -- src/contrats/prd.spec.ts`
- `pnpm exec nx test server -- src/designs/documents.spec.ts`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the Skill ships in the Runner's release).

## Out of scope

- The review page, approving and « Demander des changements »: CONCEPTION-4.
- The Revue croisée before the review: CONCEPTION-8.
- `product-design --amend` from a mockups PR: not at the MVP (the mockups' « Demander des changements » covers it).

## Dependencies

- CONCEPTION-1.
