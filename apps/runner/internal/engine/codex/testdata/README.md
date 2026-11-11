# Codex recordings

Recorded by the spike RUNNER-1 ([`docs/spikes/engines.md`](../../../../../../docs/spikes/engines.md))
with **Codex 0.167.1** (`codex --version` → `codex-cli 0.167.1`), first
with **no account**, then signed in by an **OpenAI API key without credit**
(every turn ends « Quota exceeded »): the scenarios that run a model are not
tested, no credit being added for now; RUNNER-15 (#144) records them.

- `<name>.jsonl`: the stdout of `codex app-server` (JSON-RPC, one message per
  line) or of `codex exec --json`, exactly as emitted.
- `<name>.stdin.jsonl`: what the driver wrote on stdin (app-server
  requests), in order.

| Scenario | Recordings |
|---|---|
| 1 A plain turn | not tested (no credit on the OpenAI key, the founder's choice) |
| 2 Approval requests held for hours | not tested (no credit on the OpenAI key, the founder's choice) |
| 3 A question (`item/tool/requestUserInput`) | not tested (no credit on the OpenAI key, the founder's choice) |
| 4 Interrupt then resume | not tested (no credit on the OpenAI key, the founder's choice) |
| 5 Runner restart | not tested (no credit on the OpenAI key, the founder's choice) |
| 6 Limits and usage | `06-a-quota-exceeded-app-server`, `06-b-quota-exceeded-exec` (the quota reached on an API key); the usage of a real turn: not tested (no credit on the OpenAI key) |
| 7 Authentication states | `07-a-app-server-not-signed-in` (initialize, `account/read`, `model/list`, `skills/list`, `account/rateLimits/read`, `thread/start`), `07-b-exec-not-signed-in`, `07-c-app-server-api-key` |
| 8 Skills mounting | found: `skills/list` in `07-a-app-server-not-signed-in`; used: not tested (no credit on the OpenAI key, the founder's choice) |
| 9 Permission modes | not tested (no credit on the OpenAI key, the founder's choice) |
| 10 Versions | none: a version is one line of text, given above |

Scrubbed before commit (`docs/spikes/scripts/scrub.mjs`): machine paths are
`/home/pilote/…`, the user `pilote`, the host `pilote-machine`, the
installation id zeroed. Request ids and `cf-ray` values are the real ones.
