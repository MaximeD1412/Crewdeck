---
id: RUNNER-11
title: "Contrats as data: defineContrat, the rule kinds, generation to JSON and the Go interpreter that sends the verdict"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-2]
adr: [0005, 0001, 0003]
risques: [IA-6, AGT-3]
stories: [US-48]
screens: []
revue_visuelle: false
video: false
---

## Context

US-48: the output of every Étape is checked against its Contrat. ADR 0005 makes a Contrat a declaration in `packages/contracts/src/contrats/<step>.ts` (an id, a version, its Étape and its rules), generated to JSON and embedded in the Runner, which interprets it on the Étape's worktree and its PR and sends the verdict: the content never travels, the server and the page show the rules' labels from the same declarations. This ticket builds the mechanism with one example Contrat used only by the tests; each Étape's real Contrat is written by its own ticket (IDEE-2, PROJET-4, BOUCLE-3, BOUCLE-4, CONCEPTION-3, -5, -7, -8, -9).

## Current state of the code

- Created by INFRA-1: `packages/contracts/` and `contracts:generate` (zod → JSON Schema → Go types), `packages/contracts/fixtures/`.
- Created by RUNNER-2: the protocol (`packages/contracts/src/runner/`), `apps/runner/internal/protocol/`, the server's handler registry.
- No `contrats/`, no `internal/contrat/`.

## To do

- `packages/contracts/src/contrats/define.ts`:
  - `defineContrat({ id, version, step, rules })`; `zStepId` (`idea-analysis`, `inventory`, `prd`, `mockups`, `technical-design`, `cross-review`, `split`, `code`, `review`).
  - A rule: `{ id: string /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, label: string (French), severity: 'bloquant'|'attention', kind, ...params }` with the kinds of ADR 0005:
    - `file` `{ path?: string, glob?: string, min?: int }` (exists, or at least `min` matches);
    - `sections` `{ path, headings: string[], level?: int }` (the Markdown file has these headings in this order);
    - `pattern` `{ path | glob, regex, unique?: boolean, min?: int }` (lines matching, unique capture group 1);
    - `front-matter` `{ glob, schema: JSON Schema }`;
    - `json` `{ path, schema: JSON Schema }`;
    - `pr` `{ base?: 'integration'|string, branch?: regex, body?: regex[], label?: string }` (the Étape's PR);
    - `check` `{ name: string, params?: object }` (a named Go function).
  - `packages/contracts/src/contrats/index.ts`: the registry of every Contrat and every past version (`history/<step>.v<n>.ts`), `contratLabel(contractId, version, ruleId)` for the server and the page.
  - `zVerdict` `{ contractId, version, status: 'passed'|'incomplete', failedRuleIds: string[], warningRuleIds: string[], headSha?: string }`.
- `contracts:generate` writes every Contrat to `apps/runner/internal/contrat/contrats/<id>.v<version>.json`, embedded with `go:embed`.
- Go `apps/runner/internal/contrat/`:
  - `contrat.go`: load the embedded Contrats; `Check(ctx, c Contrat, t Target) (Verdict, error)` where `Target { Dir string; PR *PullRequest }` and `PullRequest { Base, Head, Body string; Labels []string; HeadSHA string }`; blocking failures make `incomplete`, `attention` ones go to `warningRuleIds`. `pr` rules fail when `Target.PR` is nil. `base: 'integration'` compares with `Target.IntegrationBranch`.
  - `rules/<kind>.go`, one file per kind; Markdown headings parsed with `github.com/yuin/goldmark`; YAML front matter with `gopkg.in/yaml.v3`; JSON Schema with `github.com/santhosh-tekuri/jsonschema/v6`.
  - `checks/registry.go`: `Register(name string, fn func(ctx, Target, params) (bool, error))`; one example check `checks/example_nonempty_dir.go` used by the example Contrat.
  - The PR's facts are read by the Runner from `api.github.com` with the Session's token (RUNNER-10's `TokenSource`) in `apps/runner/internal/github/pulls.go`; tests use a fake.
- Protocol `step.verdict` (Runner → server) `{ stepRunId, verdict: zVerdict }` in `packages/contracts/src/runner/step.ts` with its fixture; the server's handler is RUNNER-12's.
- `crewdeck-runner contrat check <contractId> --dir <path> [--pr <number> --repo <owner/name>]` (hidden, for debugging and tests): prints the verdict as JSON.
- Example Contrat `packages/contracts/fixtures/contrats/example.ts` (id `example`, one rule of each kind), generated to `packages/contracts/fixtures/contrats/example.json`, with one passing folder `packages/contracts/fixtures/contrats/example/pass/` and one failing folder per rule `…/fail-<rule-id>/`.

## Decisions already made

- A rule's id never changes; changing a rule's parameters or label bumps the Contrat's version and moves the previous declaration to `history/` (ADR 0005: an old verdict stays readable).
- The Runner is the only interpreter; the server never reads the files (ADR 0003, ADR 0005). The server and the page show labels through `contratLabel`.
- A `check` function is written only when no rule kind fits; as soon as two Contrats need the same function, it becomes a kind (ADR 0005).
- Labels are French, in the declarations (ADR 0008: the Contrats' labels are French), not through `t()`.

## Acceptance criteria

- [ ] For each rule kind, the passing fixture passes and its failing fixture fails with exactly that rule's id (Go tests over `packages/contracts/fixtures/contrats/example/`).
- [ ] An `attention` failure leaves `status: 'passed'` with the id in `warningRuleIds`.
- [ ] A `pr` rule passes on a matching fake PR and fails without one.
- [ ] `contracts:generate` writes the JSON the Runner embeds, and leaves no diff; the generated JSON is valid against the rule schema in TypeScript.
- [ ] `contratLabel` returns the label of a rule of a past version.
- [ ] `crewdeck-runner contrat check example --dir …/pass` prints a passed verdict.
- [ ] The `step.verdict` fixture is valid in TypeScript and Go.

## Verification

- `pnpm exec nx test contracts -- src/contrats/`
- `cd apps/runner && go test ./internal/contrat/...`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- When the check runs (at the end of a Session) and the StepRun that receives the verdict: RUNNER-12. The Décisions « Contrat incomplet » and « Étape échouée »: ATOI-2.
- Each Étape's Contrat: its own ticket.

## Dependencies

- RUNNER-2.
