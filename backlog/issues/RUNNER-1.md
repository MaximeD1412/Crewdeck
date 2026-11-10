---
id: RUNNER-1
title: "Spike: drive Claude Code and Codex headless on the founder's machine, record their streams"
epic: RUNNER
type: spike
priority: P0
size: M
milestone: M2 Runner and Projets
blocked_by: []
adr: [0004]
risques: [IA-3]
stories: [US-9, US-38, US-40, US-55, US-60]
screens: []
revue_visuelle: false
video: false
hors_boucle: true
---

## Context

ADR 0004 makes the Runner drive the unmodified `claude` binary and `codex` (app-server for the Sessions the Pilote drives, `exec --json` for the Boucle), and says « the spike comes first »: before any adapter is written, prove on the founder's machine, with their real Comptes IA, every behaviour the PRD relies on. « One failure reopens the PRD. » The recorded streams become the test fixtures every adapter replays (RUNNER-4, RUNNER-5, RUNNER-6), since no test may ever run a real Moteur.

This ticket is done in a session with the founder (`hors_boucle: true`): it needs their machine, their Claude subscription, an Anthropic API key and an OpenAI API key.

## Current state of the code

- Nothing: the repository holds only documents (`docs/product/prd.md`, `docs/adr/0001` to `0009`, `CONTEXT.md`, `AGENTS.md`, `design/`, `docs/pilotage/risques.json`, `docs/research/2026-11-08-ai-providers-and-competitors.md`).
- No Go module exists yet (INFRA-1 creates `apps/runner/`); the spike's throwaway scripts live in `docs/spikes/scripts/` and are not part of the Runner.

## To do

- For each scenario below, run it by hand or with a throwaway script, record the raw stream of stdout (JSON lines) and, for the Claude permission tool and hook, what the MCP server and the hook received and answered; write what was observed.
- Scenarios, both Moteurs unless said:
  1. A plain turn: a prompt, the streamed assistant text, a tool call (`Read`, `Bash`), the final result with its usage and cost fields.
  2. A permission request that waits for hours: Claude through `--permission-prompt-tool` on an MCP server, left unanswered for at least 2 h, then answered « allow », then another answered « deny »; Codex app-server's approval request (command and file change), same waits.
  3. A Skill's `AskUserQuestion` (Claude) held by a `PreToolUse` hook, answered through the hook; note the exact hook output that makes Claude receive the answer.
  4. Interrupt then resume: interrupt mid-turn, then resume with `--resume <session id>` (Claude) and the app-server's thread resume (Codex); a message sent after the resume.
  5. A Session that survives a Runner restart: kill the driving process (not the Moteur's state), restart, resume from the Moteur's own session id; what is lost.
  6. Limits and usage: the events or exit codes when the 5-hour window or the weekly window of the Claude subscription is reached (provoke it on a cheap model or record it when it happens during the week), the usage figures each Moteur reports (windows, reset times, tokens, cost), and what an API key reports as cost.
  7. Authentication states: not signed in, signed in by subscription, API key in the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`); how each Moteur lists its models and says that a model is not in the plan.
  8. Skills mounting: Claude with `--plugin-dir` on a plugin directory holding one `skills/<name>/SKILL.md`; Codex with a `CODEX_HOME` holding the same Skill; the Skill is found and used.
  9. Permission modes: Claude `--permission-mode bypassPermissions` and the mode the Pilote-driven Sessions use (ADR 0004 calls it `auto`: record the exact flag), Codex's full-auto equivalent for `exec`.
  10. The versions of both binaries used, and how to read them (`claude --version`, `codex --version`).
- Write `docs/spikes/engines.md`: one section per scenario with the command line, what happened, the verdict (works / works with a caveat / fails), and for each Moteur the list of normalised events the adapter will emit (message, tool-call, question, permission-request, usage, limit-reached, auth-required, result, error) with the raw event they come from.
- Save the scrubbed recordings to `apps/runner/internal/engine/claude/testdata/<scenario>.jsonl` and `apps/runner/internal/engine/codex/testdata/<scenario>.jsonl`, one file per scenario, plus a `README.md` in each `testdata/` naming the binary version recorded.
- If a scenario fails in a way that breaks a story (US-9, US-38, US-40, US-55, US-60), stop: write the failure in `docs/spikes/engines.md`, label this issue `needs-human` and open an Idée « Rouvrir le PRD : <what failed> » in the console.

## Decisions already made

- Only the unmodified official binaries; no Agent SDK (ADR 0004). Codex by API key at the MVP; a ChatGPT sign-in is not tried.
- Recordings are scrubbed before commit: no API key, token, email, user name, machine path (replace with `/home/pilote/…`), repository name other than a throwaway one (`pilote/spike`). A grep for `@`, `sk-`, `/home/` other than `/home/pilote` must be empty.
- The spike works in a throwaway repository, never in a real Projet.
- The normalised event names listed above are the ones RUNNER-4 puts in `packages/contracts/src/runner/events.ts`; the spike may add one if a Moteur needs it, and says so.

## Acceptance criteria

- [ ] `docs/spikes/engines.md` has the 10 scenarios with a verdict each, for both Moteurs where they apply.
- [ ] Each scenario has its recording in the two `testdata/` folders (or a line saying why it cannot apply to that Moteur).
- [ ] The mapping raw event → normalised event is written for both Moteurs.
- [ ] The scrub check is empty on the committed recordings.
- [ ] Any failing scenario that breaks a story is labelled `needs-human` and an Idée is opened.

## Verification

- `grep -rnP 'sk-|@[a-z0-9.-]+\.[a-z]{2,}|/home/(?!pilote)' apps/runner/internal/engine/*/testdata/ docs/spikes/` prints nothing.
- Each `testdata/*.jsonl` line parses: `for f in apps/runner/internal/engine/*/testdata/*.jsonl; do jq -c . "$f" > /dev/null || echo "$f"; done`.

## For prod

Nothing.

## Out of scope

- The adapters themselves: RUNNER-4 (interface and fake), RUNNER-5 (Claude Code), RUNNER-6 (Codex).
- Asking Anthropic and OpenAI for written answers: BIZ-3.

## Dependencies

None.
