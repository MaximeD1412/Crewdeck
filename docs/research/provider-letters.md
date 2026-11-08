# Letters to the AI providers (drafts)

Drafts for the founder to send; nothing here is sent by an agent. Keep the
written answers in `docs/research/` with their date. Context:
[2026-11-08-ai-providers-and-competitors.md](2026-11-08-ai-providers-and-competitors.md).

## To Anthropic

To: Anthropic sales (https://www.anthropic.com/contact-sales). Subject:
Commercial use of Claude Code in a product with a local runner.

> Hello,
>
> We are building Crewdeck, a paid web product where a solo developer drives
> software projects with AI agents, from an idea to a merged pull request.
> We would like a written position on the exact architecture below before
> our beta.
>
> - Each user installs our « Runner » on their own machine. The Runner
>   launches the official Claude Code binary, installed by the user from
>   Anthropic and unmodified, in headless mode (`claude -p --input-format
>   stream-json --output-format stream-json`, `--permission-prompt-tool`,
>   `--resume`).
> - The user signs in to Claude Code themselves, through Anthropic's own
>   flow (`claude` / `/login`), with their own Pro, Max or Ultra
>   subscription or their own API key. We never see, collect, store or relay
>   any Claude credential or token; nothing of the sign-in leaves their
>   machine.
> - Our web app shows the session's events (messages, tool calls, file
>   changes, permission requests) and sends the user's messages and answers
>   back to the Runner. Each user's usage is theirs only: no pooling, no
>   resale, no switching between accounts.
> - We charge for our own software (orchestration, project tracking, UI),
>   never for Claude usage. We say the product « runs Claude Code » in plain
>   text and do not use the Claude or Anthropic names in our product's name.
>
> Our questions:
>
> 1. Is this use of the unmodified Claude Code binary, signed in by each
>    user with their own subscription, allowed for a commercial product
>    under your Commercial Terms? Does driving it headless from our Runner
>    change the answer compared to the user typing in its terminal?
> 2. If we used the Claude Agent SDK instead of the binary, with the same
>    user-owned sign-in, would that require a prior approval, and how do we
>    apply for it?
> 3. Which agreement must we sign (Commercial Terms, or another), and are
>    there conditions on the number of concurrent sessions or on unattended
>    runs (our agents implement tickets one after the other once the user
>    starts that loop)?
>
> Thank you,
> <name>, Crewdeck

## To OpenAI

To: the Sign in with ChatGPT interest form
(https://openai.com/form/sign-in-with-chatgpt-interest/), then the same text
by email if a contact is given.

> Hello,
>
> We are building Crewdeck, a paid web product where a solo developer drives
> software projects with AI agents, from an idea to a merged pull request.
> We would like to integrate Codex through Sign in with ChatGPT.
>
> - Each user installs our « Runner » on their own machine. The Runner runs
>   the official Codex binary: `codex app-server` for interactive sessions
>   shown in our web app, and the Codex SDK for the unattended runs the user
>   starts explicitly (an agent loop that implements tickets one after the
>   other, which the user can stop and revoke at any time).
> - Tokens stay on the user's machine, under their control; our servers
>   never receive them and never proxy model requests. Usage is for the
>   signed-in user only: no pooling, no resale, no switching between
>   accounts. Users can also use their own OpenAI API key instead.
> - We charge for our own software (orchestration, project tracking, UI),
>   never for model usage.
>
> Our questions:
>
> 1. What is the path to commercial Sign in with ChatGPT access for this
>    case, and what does the review require from us?
> 2. Your plan-usage terms require that users can use their ChatGPT plan
>    without paying the app: concretely, what must stay usable for free in
>    Crewdeck, and which features may we charge for separately?
> 3. Is the agent loop covered when the user gives an explicit, revocable
>    consent before it starts? Must that consent be per run, per project or
>    once?
> 4. Until we have access: is a commercial product allowed to drive
>    `codex app-server` or the Codex SDK with the user's own API key, without
>    any approval?
>
> Thank you,
> <name>, Crewdeck
