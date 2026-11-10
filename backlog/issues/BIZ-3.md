---
id: BIZ-3
title: "Send the letters to Anthropic and OpenAI and keep their written answers"
epic: BIZ
type: externe
priority: P1
size: S
milestone: M0 Skeleton and delivery
blocked_by: []
adr: [0004]
risques: [IA-1, IA-2]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

The PRD's « Open questions »: may the Runner drive the unmodified Claude Code binary signed in with the Pilote's own subscription in a paid product (answer before the beta), and can Crewdeck access OpenAI's « Sign in with ChatGPT », and what must stay free to respect its terms (before the business model). The drafts are in `docs/research/provider-letters.md`; « nothing here is sent by an agent ». Until the answers, the MVP works with API keys for every Moteur (PRD « Constraints », ADR 0004), so nothing in the code waits for them.

## Current state of the code

- `docs/research/provider-letters.md`: the two drafts (Anthropic through sales contact; OpenAI).
- `docs/research/2026-11-08-ai-providers-and-competitors.md`: the terms as read on 2026-11-08.

## To do

- [ ] Reread both drafts against the current state (Runner in Go, ADR 0004; API keys always; no pooling) and adjust the wording if needed.
- [ ] Send the Anthropic letter through the contact named in the draft; send the OpenAI letter (« Sign in with ChatGPT » partner request and the plan-usage question) through the channel named in the draft.
- [ ] Note the date sent in a comment here; set a reminder at 3 weeks.
- [ ] When an answer arrives: save it as `docs/research/<date>-<provider>-answer.md` (the text, the date, the sender's role, no personal email), open a PR; if it changes what the PRD says, open an Idée for a `product-design --amend`; update `docs/pilotage/risques.json` IA-1 or IA-2 in the same PR.
- [ ] Close this ticket when both answers are saved, or when the founder decides to stop waiting (comment why).

## Decisions already made

- The MVP does not depend on the answers: API keys for every Moteur, subscription only where the provider allows it (PRD « Constraints »).

## Acceptance criteria

- [ ] Both letters are sent and their dates are in a comment of this ticket.
- [ ] Each answer received is in `docs/research/`, merged, with the risks updated.

## Verification

- `ls docs/research/*-answer.md` once answers arrive.

## For prod

Nothing.

## Out of scope

- Changing the Moteurs' adapters after an answer: a new Idée.

## Dependencies

None.
