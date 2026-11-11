# Claude Code recordings

Recorded by the spike RUNNER-1 ([`docs/spikes/engines.md`](../../../../../../docs/spikes/engines.md))
with **Claude Code 2.1.319** (`claude --version` → `2.1.319 (Claude Code)`),
signed in by subscription, models `haiku` (Haiku 5.5) and `sonnet` (scenario 6).

- `<name>.jsonl`: the stdout of `claude -p --input-format stream-json
  --output-format stream-json --verbose …`, exactly as emitted, one event per
  line. What the adapter parses and the fake binary replays.
- `<name>.stdin.jsonl`: what the driver wrote on stdin (user messages,
  control requests), in order.
- `<scenario>.permission-tool.jsonl`: the JSON-RPC messages of the MCP
  server behind `--permission-prompt-tool`, `{at, direction: "in"|"out",
  message}`; several runs of a scenario share it, in order.
- `<scenario>.hook.jsonl`: what the `AskUserQuestion` `PreToolUse` hook
  received (`direction: "in"`) and answered (`"out"`, its stdout under
  `stdout`).

| Scenario | Recordings |
|---|---|
| 1 A plain turn | `01-plain-turn` |
| 2 A permission request held for hours | `02-permission-allow`, `02-permission-deny` |
| 3 A Skill's question held by a hook | `03-a-updated-input`, `03-b-deny-reason`, `03-c-held-2h` |
| 4 Interrupt then resume | `04-interrupt`, `04-resume` |
| 5 Runner restart | `05-a-kill-mid-stream`, `05-a-resume`, `05-b-kill-pending-permission`, `05-b-resume` |
| 6 Limits and usage | `06-a-usage-subscription`; `06-b-limit-reached` not recorded yet |
| 7 Authentication states | `07-a-subscription`, `07-b-not-signed-in`, `07-c-unknown-model` |
| 8 Skills mounting | `08-skills-mounting` |
| 9 Permission modes | `09-b-auto`, `09-c-auto-outside`; `09-a-bypass` not recorded yet |
| 10 Versions | none: a version is one line of text, given above |

Scrubbed before commit (`docs/spikes/scripts/scrub.mjs`): machine paths are
`/home/pilote/…`, the user `pilote`, emails `<email>`, the host
`pilote-machine`. Session ids, tool use ids and timings are the real ones.
