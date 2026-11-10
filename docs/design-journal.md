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

## Découpage (2026-11-10)

92 tickets in 14 epics and 8 milestones (`backlog/`), validated in one pass.
Answers of the round: the Boucle (M4) before Idées (M5) and Conception (M6),
so that Crewdeck's Boucle runs early on tickets made by the console; the
Inventaire drafted by the Rôle Conception; a milestone's « fin estimée » =
its open Tickets ÷ the Tickets the Projet merged per day over the last 14
days (« pas encore d'estimation » when none); BIZ-2's sign-up page built by
the founder outside the repository.

### Gaps found while writing, settled in the tickets

- No mockup for approving a new Appareil (E2E-3: Dialog and Banner, an
  « Appareils » card in the Paramètres); OPS-1's « invite a second Appareil
  during the getting started » has no mockup either (E2E-3: a caution Banner).
- `parametres.html` mixes push subscriptions and Appareils in « Notifications »
  (ATOI-4: the push subscription only; revoking an Appareil is E2E-4), and has
  no place for the time zone (PARAM-1: a « Compte » card).
- The server side of an Action sensible was only a path in AGENTS.md
  (CORE-7: the `seq` captured when the dialog opens, 409
  `sensitive-action.stale`). `boucle-planification.html` puts a form inside the
  confirmation: CORE-7's dialog accepts a form section built by the core.
- `connexion.html` has no error state (CORE-4: a halt Banner).
- `demarrage*.html` show a link code `7KQ4-M2PX`; ADR 0003 needs 4 + 26
  characters: the full code is in the command, « code 7KQ4 » elsewhere
  (RUNNER-3). The proof « over both keys » makes the link two requests
  (RUNNER-3).
- `runner-hors-ligne.html` shows `crewdeck-runner start`, absent from ADR
  0004: RUNNER-8 adds `start` and `stop` and its PR amends the ADR's table;
  ATOI-3 shows `restart` until then.
- `a-toi.html` shows an agent's question and a permission's command, which
  ADR 0003 keeps encrypted: read live from the Runner through the relay
  (SESSION-3), a generic line while it is offline. A blocked Ticket's reason,
  the Pilote's answers and change requests are GitHub comments read and
  posted by the browser; the server keeps comment ids only (BOUCLE-5,
  BOUCLE-6, CONCEPTION-4). The Inventaire has no PR: its « Demander des
  changements » goes through the relay to a new Session (PROJET-5).
- Idées carry a per-Pilote number (« #63 ») in the mockups, against ADR 0008's
  « the only human numbers are GitHub's »: IDEE-1 adds it as an exception.
  Impact and effort are 1 to 5 (ADR 0005) shown « faible / moyen / fort »
  (IDEE-2).
- `statistiques.html` lacks the p95 health ADR 0007 asks for (PILOTAGE-3: a
  fifth Stat). `ticket.html` orders Checks before Review while CI skips drafts
  until the Review passes (BOUCLE-5 shows the states as they come). « Compte IA
  déconnecté » has no mockup row (BOUCLE-7: like « Limite atteinte »).
- ADR 0002's events have no issue-dependency event: blocked-by changes are
  caught by the next `issues` event or the 15-min reconciliation (BOUCLE-1).
  The App cannot read a user's Project board: priority and size are labels
  `priority:P<n>` and `size:<S>` (PROJET-3 creates them, CONCEPTION-9 sets
  them, BOUCLE-1 reads them).
- ADR 0005 has no rule kind for « every file of a glob has a line »: PROJET-4
  adds the `check` `each-file-has-line`, to promote to a rule kind when
  CONCEPTION-7 needs it too.
- ADR 0004 says the Runner needs no Node, but the Maquettes Étape needs
  `agent-browser` for its captures (CONCEPTION-5: the Étape fails with the
  install command). The Idée analysis runs outside any repository:
  `projectId` nullable on StepRun and AgentSession (IDEE-2).
- ADR 0009 had no alert for a failed backup: `/api/health` exposes the last
  backup's age, watched by a daily workflow (INFRA-8). The monthly restore
  check runs from the founder's machine (the credentials never go to GitHub).

### Observations

- Six forks wrote the tickets in parallel from one list of shared seams
  (paths, models, Décision kinds, routes). They still diverged on six seams
  (who owns a column, the getting-started gate, who interrupts Sessions, Skill
  folder names, Décision labels repeating their kind, the shared document
  reader), each caught only by reading their reports. **To generalise**:
  plan-backlog writes the seams file first (`backlog/seams.md`, a section per
  owning ticket) and the check script greps tickets for names that differ
  from it.
- `create-issues.py` puts priority and size in board fields only; a project
  whose own tool reads labels (Crewdeck's Boucle) needs them as labels too.
  **To generalise**: an option of `backlog.json` to add `priority:` and
  `size:` labels.
