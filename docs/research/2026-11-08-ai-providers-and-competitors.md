# AI providers' terms and competitors — 2026-11-08

What the product design of Crewdeck read about running Claude Code and Codex
inside a paid product, and about the products close to it. Input of the
technical design (adapters, Runner, authentication) and of the business
model. Not legal advice: re-check every source before the beta and keep the
providers' written answers next to this file.

Inputs: two notes written with ChatGPT for the founder
([brief](inputs/2026-11-08-brief-agents-ia.md),
[competition and compliance](inputs/2026-11-08-analyse-concurrentielle.md)).
Every claim below was re-read on the sources on 2026-11-08; what could not
be read is marked so.

## 1. What exists today (the founder's dotfiles console, not Crewdeck)

Crewdeck has no code yet. The founder's personal console (repository
`dotfiles`) is the prototype these notes call « case B »:

| Use | How | Where (dotfiles) | Account |
|---|---|---|---|
| Console sessions | `@anthropic-ai/claude-agent-sdk` 0.3.318, `query()` in one host process per session | `agents/tools/console/server/session-host/main.ts` | Subscription: `ANTHROPIC_API_KEY` is removed on purpose; the SDK's bundled CLI reads the local Claude Code sign-in. No token goes through the console. |
| agent-loop | `claude -p --permission-mode bypassPermissions` | `agents/tools/agent-loop/agent-loop.sh` | Subscription, official binary |
| ideas, release | `claude -p` | `agents/tools/ideas/ideas.mjs`, `agents/tools/release/release.mjs` | Subscription |
| Cross review | `codex exec -s read-only` | `agents/tools/design` | The founder's Codex sign-in |

Fine for personal use. **The console sessions are exactly the Agent SDK +
subscription pattern a third-party product may not ship** (below); agent-loop
is close to the allowed one (the official binary).

## 2. Matrix: provider × account × integration

Legend: **documented** (quoted from the provider), **interpretation** (ours),
**to confirm** (ask the provider in writing).

| Provider | Integration | Account | Technically | Commercially | Source |
|---|---|---|---|---|---|
| Anthropic | Agent SDK | Pilote's subscription | yes | **not allowed unless previously approved** (documented) | SDK overview: « Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. » Legal: third parties may not « route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users ». |
| Anthropic | Official `claude` binary, unmodified, signed in by the Pilote, driven headless by the Runner | Pilote's subscription | yes (see §3) | **allowed for the binary** (documented); **whether driving it headless counts: to confirm** | Legal: nothing prevents « an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code ». Conditions: Commercial Terms; binary not modified, no sign-in method removed; no paying for, reselling or intermediating usage; each user authenticates themselves; « runs Claude Code » allowed in text, not in the product's name. |
| Anthropic | Agent SDK or binary | Pilote's API key | yes | **allowed** (documented: the recommended path for third parties) | Legal: developers « should use API key authentication through Claude Console or a supported cloud provider ». |
| Anthropic | any | — | — | **never collect, store or relay Claude.ai credentials or session tokens** (documented) | Legal page. |
| OpenAI | `codex app-server` | Pilote's ChatGPT sign-in (native) | yes | **not allowed for commercial or hosted services** (documented, from a summary of the page, not verbatim) | learn.chatgpt.com/docs/app-server |
| OpenAI | `codex app-server` | Sign in with ChatGPT (SIWC) | yes | **selected partners only** (documented); paid apps use the interest form | developers.openai.com/siwc/request-client-id: « currently offered to a select group of commercial partners ». |
| OpenAI | `codex app-server` or Codex SDK | Pilote's API key | yes | **likely allowed** (interpretation: ordinary API use); **to confirm** | not stated on the pages read |
| OpenAI | SIWC plan-usage terms (consent for background work, local token storage, « no charge » for plan usage) | — | — | **not verified**: the terms page answered 403 to automated reads | openai.com/policies/sign-in-with-chatgpt-terms — read it in a browser |

Also documented (Anthropic help, update of 2026-10-07): Max, Ultra and Team
plans include monthly API credits, usable with the Agent SDK and `claude -p`
through an API key of the linked Console organization. A Max Pilote can use
the API-key path without paying more, within those credits.

## 3. The official binaries can be integrated

**Claude Code** has a headless mode made to be driven by another program
(code.claude.com/docs/en/headless, CLI reference):

- `claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages`: the Runner writes the Pilote's messages on
  stdin and reads one JSON event per line (partial text, tool calls and
  results, final result with cost and session id);
- `--permission-prompt-tool mcp__<server>__<tool>`: permission requests go to
  an MCP tool the Runner provides, which asks the Skin and answers;
- a `PreToolUse` hook returning `defer` parks a question
  (`AskUserQuestion`) in the result; the Runner shows it and resumes;
- `--resume <session>`, `--model`, `--include-hook-events`.

The Agent SDK is a wrapper over this same protocol. What is lost without
it: a few control messages (clean interrupt, changing the permission mode
mid-session) that are not publicly documented; interrupting falls back to
stopping the process and `--resume`.

**Codex**: `codex app-server` is the official binary's integration protocol
(JSON-RPC: `thread/start`, `turn/start`, `turn/interrupt`, `model/list`,
`review/start`, approval requests; some methods behind `experimentalApi`, the
WebSocket transport « experimental and unsupported »). OpenAI: « If you are
automating jobs or running Codex in CI, use the Codex SDK instead »: the
interactive windows on app-server, the Boucle's unattended runs on the Codex
SDK or `codex exec`.

## 4. Competitors (vendor pages, 2026-11-08; marketing claims, not tested)

| | Structured process | Human gates | UI customization | AI accounts | Price |
|---|---|---|---|---|---|
| **Conductor** | agents, workspaces, PRs | — | — | Agent SDK + Claude subscription (blog, 2026-06-15; no Anthropic agreement mentioned); SIWC partner (changelog 0.89.0, 2026-09-29; listed by OpenAI) | joining Meta: no sign-ups since Nov 4, Cloud read-only Nov 13 and shut down Nov 20, local app wound down early 2027 |
| **Paradev** (ex-Superset) | automations | none | none | own accounts or API keys | Free; Pro $20/user/mo |
| **Shuriken** | none (« project changes wait for your OK ») | that OK | terminal look | own subscription or key; **automatic switching between accounts** when one « runs dry » | Free (2 sources); Pro €49/mo |
| **VibeiDE** | closest: « Plan council » (one provider plans, the other reviews), « Turbo » (dependency graph), review queue | « mark reviewed » (does not approve code) | **an illustrated « Office view »** | the installed CLIs' own sign-in | $7.99/mo (launch price) |
| **T3 Code** | none (diff review before push) | — | by forking (MIT) | `claude auth login`, `codex login`; listed by OpenAI among SIWC open-source integrations | free, open source |

None offers Idée triage, a PRD, mockups, a technical design, Tickets split
into GitHub issues, or one inbox of Décisions across stages; none offers a
Skin SDK (T3 needs a fork, losing updates). The illustrated office exists
(VibeiDE): the isometric Skin alone does not differentiate, the library of
Composants does. Commodity, not to prioritize: number of agents supported,
one-click PR, parallel agents, basic remote control. Excluded: switching
accounts to get past limits.

## 5. Direction for the technical design (not decided here)

- Runner adapters per **Moteur**, each declaring its capabilities
  (streaming, native review, interrupt, resume, approvals, models) and its
  **Compte IA** modes; events normalized for the Skin, provider details
  kept.
- Claude: the official binary signed in by the Pilote, driven headless;
  API key always available. Agent SDK + subscription only with Anthropic's
  written approval.
- Codex: app-server for interactive sessions, Codex SDK / `codex exec` for
  the Boucle; API key always available; ChatGPT plan only through SIWC.
- No AI credential leaves the Runner; the backend gets state and events,
  never keys or tokens.
- A switch between **Moteurs** inside a Ticket passes a context package
  (approved Conception, Ticket, branch, diff, test results), never a resumed
  session.

## Sources (read 2026-11-08)

- Anthropic, Legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
- Anthropic, Agent SDK with your Claude plan: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Anthropic, Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Anthropic, headless mode and CLI reference: https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/cli-reference
- OpenAI, Codex app-server: https://learn.chatgpt.com/docs/app-server
- OpenAI, SIWC partner apps: https://learn.chatgpt.com/docs/sign-in-with-chatgpt
- OpenAI, SIWC client ID: https://developers.openai.com/siwc/request-client-id
- OpenAI, SIWC for open-source apps and Codex app-server: https://developers.openai.com/siwc/token-sharing-open-source
- OpenAI, Codex as a platform: https://developers.openai.com/blog/codex-as-a-platform
- OpenAI, SIWC terms (not readable automatically): https://openai.com/policies/sign-in-with-chatgpt-terms/
- Conductor: https://www.conductor.build/blog/claude-subscription-update, https://www.conductor.build/changelog/0.89.0-sign-in-with-chatgpt, https://www.conductor.build/announcement, https://www.conductor.build/docs/reference/harnesses/codex
- Paradev: https://paradev.com/pricing
- Shuriken: https://shuriken.sh/, https://shuriken.sh/pricing, https://shuriken.sh/features
- VibeiDE: https://vibeide.dev/, https://vibeide.dev/docs/product-facts/
- T3 Code: https://t3.codes/
