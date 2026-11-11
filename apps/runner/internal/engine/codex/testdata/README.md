# Codex recordings

Recorded by the spike RUNNER-1 ([`docs/spikes/engines.md`](../../../../../../docs/spikes/engines.md))
with **Codex 0.167.1** (`codex --version` → `codex-cli 0.167.1`), with an
empty `CODEX_HOME` and **no account**: the scenarios that need a model wait
for an OpenAI API key.

- `<name>.jsonl`: the stdout of `codex app-server` (JSON-RPC, one message per
  line) or of `codex exec --json`, exactly as emitted.
- `<name>.stdin.jsonl`: what the driver wrote on stdin (app-server
  requests), in order.

| Scenario | Recordings |
|---|---|
| 1 A plain turn | waits for an API key |
| 2 Approval requests held for hours | waits for an API key |
| 3 A question (`item/tool/requestUserInput`) | waits for an API key |
| 4 Interrupt then resume | waits for an API key |
| 5 Runner restart | waits for an API key |
| 6 Limits and usage | waits for an API key (`account/rateLimits/read` without an account is in `07-a-app-server-not-signed-in`) |
| 7 Authentication states | `07-a-app-server-not-signed-in` (initialize, `account/read`, `model/list`, `skills/list`, `account/rateLimits/read`, `thread/start`), `07-b-exec-not-signed-in`; API key waits |
| 8 Skills mounting | found: `skills/list` in `07-a-app-server-not-signed-in`; used: waits for an API key |
| 9 Permission modes | waits for an API key |
| 10 Versions | none: a version is one line of text, given above |

Scrubbed before commit (`docs/spikes/scripts/scrub.mjs`): machine paths are
`/home/pilote/…`, the user `pilote`, the host `pilote-machine`, the
installation id zeroed. Request ids and `cf-ray` values are the real ones.
