# Journal of Crewdeck's technical design

> Material for the retro. Deleted once the skills are updated.

Model: the dotfiles console (`~/dotfiles/agents/tools/console`, ADRs
0001-0005 in `~/dotfiles/docs/adr/`), the prototype Crewdeck replaces;
personal-os for the infra and the operational parts of AGENTS.md
(`~/projects/personal-os/AGENTS.md`, `.github/workflows/`,
`scripts/worktree.sh`, ADRs 0023-0032).

## Inventory (2026-11-09)

- No code: the repository holds the PRD, the glossary, the mockups (in code,
  `design/`) and the research on the AI providers (PR #3, still open).
- Already decided, not reopened: SaaS hosted by us; a Runner on the Pilote's
  machine with their own Comptes IA; GitHub only at the MVP but behind a
  Connecteur; end-to-end encryption Runner ↔ browser for conversations, code
  and diffs; < 2 s p95; the Composants library and the core's confirmation of
  the Actions sensibles; the mockups are never imported by the
  implementation (`design/DESIGN.md`); UI in French at the MVP.
- The research (`docs/research/2026-11-08-ai-providers-and-competitors.md`)
  rules out the console's pattern (Agent SDK + subscription) for a product:
  the Runner drives the unmodified binaries.

## Decisions

- 2026-11-09: PR #5 (amended PRD, merged during the first round) settles
  three of its questions: a Session shows only its title and state while the
  Runner is offline (US-60), so the server stores no ciphertext; spends are
  shown in euros, converted from the provider's bill; « absent » means no
  visible Crewdeck tab for 2 min (US-18), so tabs report their visibility.
- 2026-11-10: the Runner in Go (founder's choice over TypeScript): small
  static binary, crypto in the standard library; contracts generated from
  zod to Go. Consequence: Contrats became declarative data interpreted by
  the Go Runner (ADR 0005), not TypeScript checkers.
- 2026-11-10: Lit web components over React, after the founder asked: a
  Moddeur replaces one Composant in any framework, Emplacements are native
  slots (ADR 0006).
- 2026-11-10: Idées encrypted end to end, after the founder's concern that
  storing someone's Idées readable would be badly received (ADR 0003).
- 2026-11-10: a ticket drafted from an Idée (US-56) is a GitHub issue
  without `ready-for-agent`; validating adds the label (console's pattern,
  no visible difference).
- 2026-11-10: Vitest everywhere in TypeScript, not personal-os's Jest: the
  Composants need Vitest's browser mode, one runner is simpler.
- 2026-11-10: `.process.json` keeps no `setupCmd` until `worktree.sh`
  exists: the ticket that creates it adds the keys.

## Observations

- The research doc that the PRD cites lives on an unmerged branch (PR #3).
  **To generalise**: technical-design checks that every file the PRD cites
  is on the integration branch, else asks to merge it first.
- PR #5 was merged while the first round waited for answers; three
  questions became moot. **To generalise**: before sending a round, fetch
  the integration branch and list the open PRs that touch `docs/product/`
  or `design/`; after sending it, re-check before writing.
- A first-round answer (A1 b, Go) silently invalidated two other recos
  (A5 packaging, D19 TypeScript checkers). **To generalise**: after each
  round, re-read every reco against the answers that differ from a reco
  and list the knock-on effects in the follow-up round.
- `setupCmd` pointing at a script that does not exist yet would break the
  first agent-loop run. **To generalise**: technical-design never sets
  `.process.json` commands for files the backlog has not created.
- Go is not installed on the founder's machine yet: `.mise.toml`
  (walking-skeleton ticket) installs it; `worktree.sh setup` runs
  `mise install`.
- The cross-review (7 remarks, all fixed) found what the rounds missed:
  a 20-bit pairing secret the server could grind offline, the Runner's
  token without Issues, the server writing content files, verdicts not
  bound to a SHA, the backup key living only on the VPS, the release SHA
  differing from staging's. **To generalise**: technical-design checks,
  before committing, every content path (who reads and who writes each
  file) against the privacy ADR, every gate against a commit SHA, and every
  secret against « where is its second copy ».
