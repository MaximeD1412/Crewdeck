# Spike: driving Claude Code and Codex headless (RUNNER-1)

> **State:** Claude Code done on the founder's subscription, except the limit
> event (scenario 6, recorded when it happens) and `bypassPermissions`
> (scenario 9a, to be run by the founder). Codex: version, sign-in states
> (none, API key), models, Skills discovery and the quota reached on an API
> key recorded; the scenarios that run a model are **not tested**: the
> founder's OpenAI key has no credit and none will be added for now. No
> scenario so far breaks a story; the
> one that came closest, a permission request waiting for hours, works
> once the Runner's MCP server sends progress notifications (scenario 2).

[ADR 0004](../adr/0004-the-runner.md) says the spike comes first: prove on the
founder's machine every behaviour the PRD relies on before an adapter is
written. This page is what was observed; the recordings are the fixtures
RUNNER-4, RUNNER-5 and RUNNER-6 replay.

## Setup

| | |
|---|---|
| Machine | Linux (WSL2), x86_64 |
| Claude Code | `claude --version` → `2.1.319 (Claude Code)`; Compte IA: the founder's subscription (`subscriptionType: "Claude Max"`). No API key tried (the founder's choice for this session). |
| Codex | `codex --version` → `codex-cli 0.167.1` (`npm i -g @openai/codex@0.167.1`). Signed in by the founder's OpenAI API key, whose account has no credit (every turn ends « Quota exceeded »; no credit will be added for now); a ChatGPT sign-in is not tried (ADR 0004). |
| Repository | A throwaway one, `git init` in a temporary folder, scrubbed to `/home/pilote/spike` |
| Model | `haiku` (Haiku 5.5) for every Claude scenario but 6 (`sonnet`) |

The throwaway harness is in [`scripts/`](scripts/); it is not the Runner.

- `drive.mjs` starts a Moteur, plays a list of steps on its stdin (a user
  message, a control request, wait for an event type, sleep, `SIGKILL`) and
  records stdout, stdin and a timestamped timeline. It drops the `CLAUDE*`
  variables of the calling session.
- `claude.sh` runs one Claude scenario through `drive.mjs` with the flags of
  ADR 0004 plus what the spike found necessary:

  ```sh
  claude -p --input-format stream-json --output-format stream-json --verbose \
    --setting-sources project --strict-mcp-config \
    --mcp-config <dir>/mcp.json --settings <dir>/settings.json \
    --permission-prompt-tool mcp__spike__permission_prompt \
    --model haiku [--include-partial-messages] [--plugin-dir …] [--resume <id> | --session-id <uuid>]
  ```

- `perm-mcp.mjs` is the MCP server (stdio) behind
  `--permission-prompt-tool`: it logs every JSON-RPC message both ways and
  holds each call until an answer file exists.
- `question-hook.mjs` is the `PreToolUse` hook (matcher `AskUserQuestion`,
  `timeout: 10800`), held the same way.
- `answer.mjs` answers what is pending (`allow`, `deny`, `ask <label>`).
- `record-limit.sh` records scenario 6's limit event when it happens;
  `scrub.mjs` and `collect.mjs` scrub the recordings into `testdata/`;
  `check.sh` runs the ticket's verification.

### Recordings

`apps/runner/internal/engine/claude/testdata/` and
`apps/runner/internal/engine/codex/testdata/`, one set per recording:
`<name>.jsonl` is the Moteur's stdout exactly as emitted (what an adapter
parses), `<name>.stdin.jsonl` what the driver wrote, and per scenario
`<scenario>.permission-tool.jsonl` / `<scenario>.hook.jsonl` the side
channels, `{at, direction, message|payload}` per line (the timestamps prove
the waits). A scenario with several runs has one recording per run
(`04-interrupt`, `04-resume`), each named after its scenario's number.

## 1. A plain turn

**Claude** (`01-plain-turn`): one message asking to `Read` the README, run
`ls` with `Bash` (`--allowedTools "Read,Bash(ls:*)"`) and answer in one
sentence, with `--include-partial-messages`.

- Stream: `system/init` (session id, model, tools, MCP servers, plugins,
  Skills, `permissionMode`, `apiKeySource`, `claude_code_version`), then
  `stream_event` (Anthropic's raw SSE: `message_start`,
  `content_block_delta` with `text_delta`, `message_stop`) while it streams,
  `assistant` with a `tool_use` block per call, `user` with the
  `tool_result`, a `rate_limit_event`, `assistant` text, `result`.
- `result`: `subtype: "success"`, `is_error`, `result` (the final text),
  `num_turns`, `duration_ms`, `total_cost_usd`, `usage` (tokens, cache) and
  `modelUsage` per model (`costUSD`, `costBasis`, `contextWindow`),
  `terminal_reason: "completed"`, `permission_denials`.
- Without `--include-partial-messages` there is no `stream_event`: the
  text arrives once per assistant message. The Runner needs the flag to show
  a Session as it streams (US-9).

**Verdict: works.**

**Codex**: not tested (no credit on the OpenAI key, the founder's choice) (`exec --json` and app-server
`turn/start`).

## 2. A permission request that waits for hours

**Claude**: default permission mode, a message asking to run `touch
<file>` with `Bash`, the request left unanswered.

**A silent MCP call is aborted after about 30 minutes**
(`02-permission-idle-timeout`): with nothing sent back, Claude Code gives up
at 1829 s and the tool result is « Error calling tool (Bash): MCP server
"spike" tool "permission_prompt" sent no response or progress for 1829s;
aborting. If this server is configured in your MCP settings, set a
per-server "timeout" (ms) to allow longer silent runs for just this server;
otherwise set CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT (ms) globally (0 disables). »
The model then says the command did not run, or (in a second Session) asks
again with a new `tool_use_id`. Checked in a minute with
`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=20000`: a silent call is aborted at 29 s,
a call that gets an MCP `notifications/progress` (with the `progressToken`
of the call's `_meta`) every 5 s is still pending after 60 s. **The
Runner's MCP server sends a progress notification while a request waits
for the Pilote** (every minute here); `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=0`
is the fallback.

Then, with the keep-alive (`02-permission-allow`, `02-permission-deny`) and
without it but with `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=0`
(`02-permission-idle-timeout-off`): three Sessions at once, each request
left unanswered for 2 h 05 min, then answered `allow` (followed by a second
request in the same Session, answered `deny`), `deny`, and `allow`.

- The request reaches the MCP server as `tools/call` on
  `permission_prompt` with `arguments: {tool_name, input, tool_use_id}` and
  `_meta: {"claudecode/toolUseId", progressToken}`. The answer is the tool's
  text content, a JSON string: `{"behavior":"allow","updatedInput":<input>}`
  or `{"behavior":"deny","message":"…"}`.
- While it waits, stdout shows only `system/status` `requesting`: nothing in
  the stream says a request is pending. The Runner knows it from its own MCP
  server.
- After 2 h 05 min (requests at 09:22:23, answers at 11:27:37 UTC; 125
  progress notifications each in the kept-alive Sessions):
  - `allow`: the command runs, Claude says « Done. »; the second request of
    the Session, answered `deny`, comes back to the model as the tool result
    « Refusé par le Pilote. » (the `message`, as written) and it does not
    retry;
  - `deny`: the same, with « Refusé par le Pilote après deux heures. »;
  - `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=0` without any progress: the call
    waited 2 h 05 min too and was allowed.
- `result.permission_denials` lists the denied calls of the turn.

**Verdict: works with a caveat** (the Runner keeps the call alive with
progress notifications, or Claude aborts it after 30 minutes).

**Codex**: not tested (no credit on the OpenAI key, the founder's choice) (`item/commandExecution/requestApproval`
and `item/fileChange/requestApproval`, server requests of the app-server,
answered `{decision: "accept" | "acceptForSession" | "decline" | "cancel"}`).

## 3. A Skill's `AskUserQuestion` held by a hook

**Claude** (`03-question`, `03-question-held`): a Skill mounted with
`--plugin-dir` (`choisir-couleur`) asks one question with `AskUserQuestion`.
The `PreToolUse` hook receives `{session_id, transcript_path, cwd,
permission_mode, hook_event_name: "PreToolUse", tool_name:
"AskUserQuestion", tool_input: {questions: [{question, header, options:
[{label, description}], multiSelect}]}, tool_use_id}`.

The hook output that makes Claude receive the answer (`03-a-updated-input`):

```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow",
  "updatedInput": {"questions": […the same questions…],
                   "answers": {"<question text>": "<label>"}}}}
```

Claude then gets the tool result « Your questions have been answered:
"<question>"="<label>". You can now continue with these answers in mind. »
and goes on (`Couleur choisie : Bleu`). The question never reaches the
permission tool.

Also tried (`03-b-deny-reason`): `permissionDecision: "deny"` with the
answer in `permissionDecisionReason`. Claude reads it, but as an error
(« PreToolUse:AskUserQuestion hook error: Le Pilote a répondu : Rouge »).
The adapter uses `allow` + `updatedInput.answers`.

A third run (`03-c-held-2h`) held the question for 2 h 05 min (hook input
at 08:52:13, answer at 10:57:13 UTC, `duration_ms` 7 503 465): Claude
received « Bleu » and finished the Skill. A hook is not subject to the
30-minute limit of MCP calls (scenario 2); only its own `timeout` counts.

**Verdict: works.**

**Codex**: not tested (no credit on the OpenAI key, the founder's choice) (`item/tool/requestUserInput`, a server
request of the app-server; Codex has no hooks for it).

## 4. Interrupt, then resume

**Claude** (`04-interrupt`, `04-resume`): `--session-id <uuid>` chosen by
the driver, a message asking for a 40-second foreground command, then a
control request `{"type":"control_request","request_id":"drv-1","request":{"subtype":"interrupt"}}`
5 s after the `tool_use`.

- Claude answers `control_response` (`subtype: "success"`), the tool result
  says the call was stopped, a `user` message `[Request interrupted by user
  for tool use]`, then `result` with `subtype: "error_during_execution"`,
  `terminal_reason: "aborted_tools"`. The same process takes the next
  message normally.
- A new process with `--resume <session id>` keeps the session id and the
  whole context (it knows its command was interrupted).
- `--session-id` lets the Runner choose the id before the Moteur starts.
- Caveat found on the way: Claude Code itself blocks a foreground `sleep
  40` and suggests `run_in_background`, so a long turn in a test must not be
  a plain `sleep`.

**Verdict: works.**

**Codex**: not tested (no credit on the OpenAI key, the founder's choice) (`turn/interrupt`, then `thread/resume`).

## 5. A Session that survives a Runner restart

**Claude**: `SIGKILL` to `claude` (what a restart of the Runner's systemd
service does to its children), then `--resume <session id>` from a new
process.

- Killed mid-answer (`05-a-kill-mid-stream`, `05-a-resume`): the turn in
  progress is lost. The transcript keeps the user's message, not the partial
  answer; after the resume Claude says it never wrote it. Only what the
  Runner had already streamed (the `text_delta`s) survives, on the Runner's
  side.
- Killed while a permission request is pending (`05-b-…`): the MCP server
  dies with `claude` (its stdin closes; no orphan process). After the resume
  the request is gone; on « Reprends où tu en étais » Claude makes the call
  again, with a new `tool_use_id`, so a new permission request, answered
  `allow`, and the command runs.
- A resumed Session does nothing until it gets a message: the Runner (or
  the Pilote) sends one.

What is lost: the turn in progress (its partial text, its pending request).
What is kept: every completed turn, the session id. This is what US-60 asks:
the Session is interrupted while the Runner is away, until it is resumed.

**Verdict: works with a caveat** (the in-flight turn is lost; the Runner
says so in the Session and resends).

**Codex**: not tested (no credit on the OpenAI key, the founder's choice) (`thread/resume` after killing
`app-server`).

## 6. Limits and usage

**Claude** (`06-a-usage-subscription`, two turns on `sonnet`):

- `rate_limit_event`: `rate_limit_info: {status: "allowed", resetsAt,
  rateLimitType: "five_hour", overageStatus, isUsingOverage, unifiedWindows:
  {five_hour: {utilization, resetsAt, status}, seven_day: {utilization,
  resetsAt, status}}}`. `utilization` is a fraction (0.2 = 20 %),
  `resetsAt` a Unix time. It came once per process here, not after every
  turn.
- `result.total_cost_usd` adds up over the process (0.027, then 0.045);
  `modelUsage[*].costBasis` is `"list"` on a subscription: an estimate at
  list price, not what is billed. Tokens are in `usage` and `modelUsage`.
- The limit reached (5-hour or weekly window): *not recorded yet*. The
  founder runs `docs/spikes/scripts/record-limit.sh` the next time it
  happens, then `collect.mjs`. Expected: a `rate_limit_event` with a
  `status` other than `allowed`, and an error on the turn.
- What an API key reports as cost: not tried (no API key in this session).

**Verdict: works with a caveat** (the windows and cost are there; the
limit-reached event is still to record).

**Codex**:

- `account/rateLimits/read` without an account answers
  `{"error":{"code":-32600,"message":"codex account authentication required to read rate limits"}}`;
  with an API key (`07-c-app-server-api-key`), `account/rateLimits/read` and
  `account/usage/read` answer « chatgpt authentication required to read
  rate limits » / « … token usage »: an API key has no windows and no
  account usage through Codex. Its spend (US-55) has to come from the tokens
  of each turn (`thread/tokenUsage/updated`, `turn.completed.usage` for
  `exec`) priced by the Runner, or from OpenAI's own billing.
- **The quota reached on an API key** (the founder's key has no credit):
  app-server (`06-a-quota-exceeded-app-server`): `thread/status/changed`
  to `systemError`, an `error` notification `{error: {message: "Quota
  exceeded. Check your plan and billing details.", codexErrorInfo:
  "usageLimitExceeded"}, willRetry: false, threadId, turnId}`, then
  `turn/completed` with `turn.status: "failed"` and the same `error`;
  3 s after `turn/start`. `exec --json` (`06-b-quota-exceeded-exec`):
  `thread.started`, `turn.started`, `error` and `turn.failed` with only the
  message (no `codexErrorInfo`), exit code 1. The Boucle's adapter
  recognises the message; the app-server gives a code.
- Usage figures of a real turn: not tested (no credit on the OpenAI key).

## 7. Authentication states

**Claude** (`07-auth-states`): a control request `{"subtype":"initialize"}`
first, then one message.

- Signed in by subscription (`07-a-subscription`): the `initialize`
  response holds `account: {email, organization, subscriptionType: "Claude
  Max", apiProvider: "firstParty"}` (email and organisation scrubbed) and
  `models: [{value, displayName, description}]`, the models the plan offers
  (aliases `default`, `opus`, `sonnet`, `haiku`, `fable` and full ids).
- Not signed in (`07-b-not-signed-in`, an empty `HOME` and
  `CLAUDE_CONFIG_DIR`): `initialize` answers `account: {tokenSource: "none"}`
  with only the aliases; the turn gets an `assistant` message with `error:
  "authentication_failed"` and the text « Not logged in · Please run /login
  », `result.is_error: true`, `terminal_reason: "api_error"`, exit code 1.
  The Runner can tell before any turn, from `tokenSource`.
- A model not available (`07-c-unknown-model`, a made-up id): `assistant`
  with `error: "model_not_found"`, `api_error_status: 404`, the text « There's
  an issue with the selected model … It may not exist or you may not have
  access to it », exit code 1. A model of a higher plan was not tried (the
  founder's plan has them all); it is expected to give the same error.
- API key in the environment: not tried.

**Codex** (`07-a-app-server-not-signed-in`, `07-b-exec-not-signed-in`, an
empty `CODEX_HOME`):

- app-server `account/read` → `{account: null, requiresOpenaiAuth: true}`;
  `model/list` works without an account (`data: [{id, displayName,
  isDefault, hidden, supportedReasoningEfforts, …}]`); `thread/start`
  works too, then logs a 401 on its WebSocket.
- `codex exec --json` → `thread.started`, `turn.started`, ten `error`
  events « Reconnecting… n/5 (unexpected status 401 Unauthorized …) »
  (WebSocket, then HTTPS), then `turn.failed`, exit code 1. It takes about
  40 s: the adapter checks the account first (`codex login status` exits 1
  with « Not logged in », or app-server `account/read`).
- `CODEX_HOME` under `/tmp` gives a warning (« Refusing to create helper
  binaries under temporary dir »): the Runner's `~/.crewdeck/` is not
  affected.
- Signed in by API key (`codex login --with-api-key`, the key on stdin,
  stored in `CODEX_HOME`), `07-c-app-server-api-key`: `account/read` →
  `{account: {type: "apiKey"}, requiresOpenaiAuth: true}`; `model/list` the
  same nine models; `codex login status` exits 0. A model outside the plan:
  not tested (no credit on the OpenAI key).

**Verdict: works** (Claude subscription and not signed in; Codex not
signed in and API key); the Claude API key is left out by the founder.

## 8. Skills mounting

**Claude** (`08-skills-mounting`): `--plugin-dir <dir>` on a folder holding
`.claude-plugin/plugin.json` and `skills/<name>/SKILL.md`. `system/init`
lists the plugin (`{name: "crewdeck-spike", path, source:
"crewdeck-spike@inline"}`) and its Skills as `crewdeck-spike:<name>`; the
model calls the `Skill` tool with `skill: "crewdeck-spike:dire-bonjour"`
and follows it. No permission is asked for the `Skill` tool. Scenario 3 is a
Skill of the same plugin.

**Verdict: works.**

**Codex**: a `CODEX_HOME` holding `skills/<name>/SKILL.md`; app-server
`skills/list` finds it (`scope: "user"`) next to Codex's own `.system`
Skills, without an account. Caveat: it also lists the Skills of
`~/.agents/skills` (the Pilote's own, `scope: "user"` too); the recording
shows it with a dummy `skill-perso`. RUNNER-6 decides whether the Session
gets a `HOME` of its own or lives with them. Using the Skill: waits for an
API key.

**Verdict: works with a caveat** (found; used: not tested, no credit on the
OpenAI key).

## 9. Permission modes

**Claude**:

- `--permission-mode bypassPermissions` (Rôles Code and Review), `09-a-bypass`:
  *to be run by the founder*. The agent running this spike was not allowed
  to start a `claude` that bypasses permissions, even in the throwaway
  repository. From the repository's root:

  ```sh
  SPIKE_NAME=09-a-bypass docs/spikes/scripts/claude.sh 09-permission-modes \
    '[{"send":"Avec l’outil Bash, lance exactement `touch bypass.txt`, puis avec l’outil Write crée `bypass.md` contenant « ok ». Dis ensuite « fait »."},{"untilType":"result","timeoutMs":180000},{"closeStdin":true},{"untilExit":true}]' \
    --model haiku --permission-mode bypassPermissions
  node docs/spikes/scripts/collect.mjs && docs/spikes/scripts/check.sh
  ```
- `--permission-mode auto` (the exact flag; `init` says `permissionMode:
  "auto"`), `09-b-auto`, `09-c-auto-outside`: a `touch`, a `git push --force
  origin main` (no remote), a `Write` outside the repository and an `rm -rf`
  of a folder outside it all ran **without any request** reaching the
  permission tool: in `auto`, Claude's own classifier approved them. What
  `auto` does with an action its classifier refuses (send it to the
  permission tool, or deny it) was not observed: the spike did not try a
  truly dangerous action.
- The default mode (no `--permission-mode`, `init` says `"default"`; the
  CLI's choices call it `manual`) sends every non-allowed call to the
  permission tool (scenarios 2 and 5).

ADR 0004 has the Sessions the Pilote drives run in `auto`, « their requests
going to the Pilote ». Observed: in `auto` the Pilote is rarely asked
anything; in the default mode, every call outside the allowed list. US-9
holds either way. Which mode those Sessions use is for RUNNER-5 to settle
with the Pilote (it changes what the Pilote sees).

**Verdict: works with a caveat** (`bypassPermissions`: to be run by the
founder).

**Codex**: 0.167.1 has no `--full-auto` any more. `codex exec --help`
offers `--sandbox read-only|workspace-write|danger-full-access`,
`--approve-for-me` (« route approval requests through automatic review
using the workspace-write sandbox ») and
`--dangerously-bypass-approvals-and-sandbox`. The equivalent of
`bypassPermissions` inside a worktree is `--sandbox workspace-write
--approve-for-me` or the bypass flag; which one: to settle when it runs with
an API key. The app-server takes an approval policy per thread. Waits for an
API key.

## 10. Versions

- `claude --version` → `2.1.319 (Claude Code)`; also in `system/init`
  (`claude_code_version`) and in the `initialize` response.
- `codex --version` → `codex-cli 0.167.1`; the app-server's `initialize`
  answers a `userAgent` holding it (`crewdeck-spike/0.167.1 (…)`).
- `codex app-server generate-ts --out <dir>` (or `generate-json-schema`)
  writes the exact protocol of the installed version: RUNNER-6 generates its
  types from it.

**Verdict: works.** No recording: a version is a line of text, not a
stream; each `testdata/README.md` names the version recorded.

## From raw events to normalised events

The names RUNNER-4 puts in `packages/contracts/src/runner/events.ts`. The
spike adds none: an interrupted turn is a `result` whose reason says so, an
unavailable model an `error` with its code.

### Claude Code

| Normalised | Raw event (stream-json unless said) |
|---|---|
| `message` | `stream_event` with `event.type: "content_block_delta"`, `delta.type: "text_delta"` (streaming); `assistant` whose `message.content[]` has `type: "text"` (the whole message) |
| `tool-call` | `assistant` content `type: "tool_use"` `{id, name, input}`; its outcome in the next `user` content `type: "tool_result"` `{tool_use_id, content, is_error}` |
| `question` | the `PreToolUse` hook's input with `tool_name: "AskUserQuestion"` (`tool_input.questions`); answered by the hook's output, `allow` + `updatedInput.answers` |
| `permission-request` | MCP `tools/call` on the `--permission-prompt-tool` server, `arguments: {tool_name, input, tool_use_id}`; kept alive by `notifications/progress`; answered by its result `{"behavior":"allow","updatedInput":…}` / `{"behavior":"deny","message":…}` |
| `usage` | `rate_limit_event.rate_limit_info.unifiedWindows` (5-hour and 7-day windows: `utilization`, `resetsAt`); `result.usage`, `result.modelUsage`, `result.total_cost_usd` (cumulative per process, `costBasis: "list"` on a subscription) |
| `limit-reached` | expected: `rate_limit_event` with `status` other than `allowed`, and the turn's error; *to confirm with `06-b-limit-reached`* |
| `auth-required` | `initialize` response `account.tokenSource: "none"` (before any turn); `assistant` with `error: "authentication_failed"` |
| `result` | `result`: `subtype: "success"` with `terminal_reason: "completed"`; `subtype: "error_during_execution"` with `terminal_reason: "aborted_tools"` after an interrupt |
| `error` | `assistant` with `error` (e.g. `"model_not_found"`, `api_error_status: 404`) and `result.is_error: true`, `terminal_reason: "api_error"`; a non-zero exit or a `SIGKILL` |

Not normalised, used by the adapter itself: `system/init` (session id,
model, Skills; it comes again with each new user message in the same
process), the MCP progress notifications (they never reach stdout), `system/status`, `system/thinking_tokens`, the
`system/task_*` events of background tools, `control_response`.

### Codex

Observed so far: the not-signed-in states and the listings. The other rows
come from the protocol of 0.167.1 (`codex app-server generate-ts`) and are
*to confirm*: they need a model to run, not tested for lack of credit on
the OpenAI key. RUNNER-6 starts from them and records its own streams once a
Compte IA Codex can run a turn.

| Normalised | app-server (Sessions the Pilote drives) | `exec --json` (Boucle) |
|---|---|---|
| `message` | `item/agentMessage/delta`; `item/completed` with an agent message item | `item.completed` with `item.type: "agent_message"` |
| `tool-call` | `item/started` / `item/completed` with a command execution, file change or MCP tool call item | `item.started` / `item.completed` with `command_execution`, `file_change`, `mcp_tool_call` |
| `question` | server request `item/tool/requestUserInput` | none (no one to ask) |
| `permission-request` | server requests `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`; answered `{decision}` | none (`--approve-for-me` or the bypass flag, scenario 9) |
| `usage` | `thread/tokenUsage/updated`; `account/rateLimits/updated`, `account/rateLimits/read` | `turn.completed.usage` |
| `limit-reached` | `error` notification with `codexErrorInfo: "usageLimitExceeded"`, then `turn/completed` with `status: "failed"` (**observed**, API key without credit) | `error` then `turn.failed` « Quota exceeded. Check your plan and billing details. », exit 1 (**observed**) |
| `auth-required` | `account/read` → `{account: null, requiresOpenaiAuth: true}` (**observed**; signed in: `account: {type: "apiKey"}`) | `turn.failed` after `error` « 401 Unauthorized » (**observed**); `codex login status` exit 1 |
| `result` | `turn/completed` | `turn.completed` |
| `error` | `error` notification; a JSON-RPC `error` response (**observed** for `account/rateLimits/read`) | `error`, `item.completed` with `item.type: "error"` (**observed**), `turn.failed`, a non-zero exit |

## Findings for the next tickets

- **RUNNER-5 (Claude)**: `--include-partial-messages` to stream;
  `--setting-sources project` and `--strict-mcp-config` so the Pilote's own
  hooks, MCP servers and Skills stay out of a Session (with the default
  sources the Pilote's user settings, hooks included, apply); `--session-id`
  to choose the id; the question hook answers with `allow` +
  `updatedInput.answers`; the hook's `timeout` must cover a question that
  waits for hours (10800 s here); the permission MCP server sends
  `notifications/progress` while a request waits, or Claude aborts it after
  about 30 minutes (scenario 2); which permission mode the Pilote's
  Sessions use (scenario 9).
- **RUNNER-6 (Codex)**: check the account before starting a turn; the
  Pilote's `~/.agents/skills` show up in a Session; types generated from
  `codex app-server generate-ts`. **Codex is not proven on a running turn**
  (no credit on the founder's OpenAI key): its approvals held for hours, its
  question, interrupt and resume, its usage figures are taken from the
  protocol, not observed. RUNNER-6 records them before its adapter relies on
  them; does an approval request survive hours, as Claude's needed a
  keep-alive, is the first thing to check. Until then Claude Code is the
  only proven Moteur.
- **Runner restart**: the turn in progress is lost; the Runner keeps what it
  streamed, marks the Session interrupted, and sends a message on resume
  (US-60).
