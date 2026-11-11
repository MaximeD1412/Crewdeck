---
id: RUNNER-15
title: "Spike, part 2: record Codex on a running turn, the Claude limit event and bypassPermissions"
epic: RUNNER
type: spike
priority: P1
size: S
milestone: M2 Runner and Projets
blocked_by: []
adr: [0004]
risques: [IA-3]
stories: [US-9, US-38, US-40, US-55]
screens: []
revue_visuelle: false
video: false
hors_boucle: true
---

## Context

RUNNER-1 recorded Claude Code on the founder's subscription and Codex as far as it goes without a running turn (`docs/spikes/engines.md`). Three things were left: the founder's OpenAI API key has no credit (every Codex turn ends « Quota exceeded », and no credit is added for now), the Claude subscription's limit event only comes when a window is actually full, and the agent running the spike was not allowed to start a `claude` with `--permission-mode bypassPermissions`. RUNNER-6 (the Codex adapter) replays Codex streams that do not exist yet.

This ticket is done in a session with the founder (`hors_boucle: true`), once a Compte IA Codex can run a turn (credit on the OpenAI key, or a ChatGPT sign-in once OpenAI grants it, risk IA-2).

## Current state of the code

- `docs/spikes/engines.md`: the 10 scenarios; for Codex, observed: not signed in, signed in by API key, model and Skill listings, the quota reached (`06-a-quota-exceeded-app-server`, `06-b-quota-exceeded-exec`); every other Codex row of the mapping is taken from the protocol of 0.167.1 and marked « to confirm ».
- `docs/spikes/scripts/`: `codex.sh` and `drive.mjs` already drive `codex app-server` (thread and turn ids captured, server requests held until answered with `answer.mjs accept|decline|input`) and `codex exec --json`; `record-limit.sh` records Claude's limit event; `collect.mjs` and `check.sh` scrub, copy and check.
- `apps/runner/internal/engine/codex/testdata/README.md` lists what is missing.

## To do

- Codex, app-server and `exec --json`, on the cheapest model that runs (`gpt-6-luna` at 0.167.1): scenarios 1 (plain turn), 2 (command and file change approvals left unanswered 2 h 05, then accepted and declined; first check whether a silent wait is aborted, as Claude's MCP call is after 30 min), 3 (`item/tool/requestUserInput`), 4 (`turn/interrupt`, then `thread/resume` in a new process), 5 (kill `app-server`, resume), 6 (`thread/tokenUsage/updated` and `turn.completed.usage` of a real turn), 8 (the Skill of `CODEX_HOME` used), 9 (`--sandbox workspace-write --approve-for-me` against `--dangerously-bypass-approvals-and-sandbox` in a worktree).
- Claude: `docs/spikes/scripts/record-limit.sh` when the 5-hour or weekly window is full; the founder runs scenario 9a (`bypassPermissions`, the command is in `engines.md`).
- `node docs/spikes/scripts/collect.mjs` (add the new recordings to its table), update `engines.md` (verdicts, the Codex mapping's « to confirm » rows), the two `testdata/README.md`.

## Decisions already made

- Those of RUNNER-1: unmodified official binaries, a throwaway repository, recordings scrubbed (`check.sh` empty).
- No credit is bought for this spike before the founder decides to; a ChatGPT sign-in only once OpenAI grants it (ADR 0004).

## Acceptance criteria

- [ ] Each Codex scenario above has its recording in `apps/runner/internal/engine/codex/testdata/` and a verdict in `docs/spikes/engines.md`.
- [ ] The Codex mapping has no « to confirm » row left.
- [ ] `06-b-limit-reached` and `09-a-bypass` are recorded for Claude, and the `limit-reached` row of the Claude mapping is confirmed.
- [ ] `docs/spikes/scripts/check.sh` prints nothing.
- [ ] Any failing scenario that breaks a story is labelled `needs-human` and an Idée is opened.

## Verification

- `docs/spikes/scripts/check.sh` exits 0 (the ticket's grep, each line parses, gitleaks).

## For prod

Nothing.

## Out of scope

- The adapters: RUNNER-5 (Claude Code), RUNNER-6 (Codex).

## Dependencies

None in the backlog: it needs a Compte IA Codex that can run a turn. It blocks RUNNER-6.
