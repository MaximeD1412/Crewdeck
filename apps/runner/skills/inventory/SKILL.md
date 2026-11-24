---
name: inventory
description: Drafts the Inventaire of a code base that becomes a Projet - its glossary (CONTEXT.md), one ADR per technical choice the code already made (docs/adr/), and the list of its apps, screens, tests and CI (docs/inventory.md) - from the code alone, on the branch crewdeck/inventaire, pushed to its origin, then reports its counts. Use as the Étape « Inventaire » of the Préparation of a Projet, or to apply the changes the Pilote asked when they sent an Inventaire back.
---

# Inventaire of an existing code base

A folder or a repository that already has code becomes a Projet: before its
Process starts, write down what the code has already decided, so that every
agent after you reads it instead of guessing it. The Pilote approves it or
sends it back with their changes; the Contrat `inventory` checks what you
deliver. Formats: [REFERENCE.md](REFERENCE.md).

Write in English, but the glossary's terms, which are in the product's
language (the UI's, often French). The commit messages are in French.

## Workflow

1. **Start the Étape.** `crewdeck-runner etape start` prints its context as
   JSON: `branch` (`crewdeck/inventaire`), `base` (the release branch, where
   the code is), `origin`. You work in the Session's worktree, on `branch`.
2. **A send-back?** When the origin already holds the branch, a first
   Inventaire was drafted and the Pilote sent it back:
   ```bash
   git ls-remote --heads origin crewdeck/inventaire
   ```
   If it prints a line, start from it (`git fetch origin crewdeck/inventaire`
   then `git reset --hard FETCH_HEAD`, in this worktree only), apply the
   changes the Pilote asked (their message in this Session; when it names
   none, ask them with `etape ask`, step 4), and go to step 6 with the
   commit message `docs(crewdeck) : inventaire revu`. Never redraft from
   scratch what they did not ask to change.
3. **Read, never run.** Read the code, its docs (README, existing
   `CONTEXT.md` and `docs/adr/`), its manifests (`package.json`, `go.mod`,
   `pyproject.toml`, `Cargo.toml`…), its CI (`.github/workflows/`, others),
   its infrastructure files and its tests. Never run the code, its tests, its
   scripts nor an install: the inventory is what the files say. Read the
   state of the work (its tickets, its PRs) only when you need it, through
   `mirror` (`mirror issue view <n> --json title,body`, `mirror search
   "<text>"`); never through another tool.
4. **Ask only what the code cannot say.** A domain word with two meanings, a
   technology present twice with no sign of which one is kept: one question
   through `crewdeck-runner etape ask --question '<json>'`, with options and
   your recommendation first. Everything the files answer, decide; a doubt
   that stays is written in the glossary's « Flagged ambiguities » or in the
   ADR's Consequences, never left implicit.
5. **Write the three files** ([REFERENCE.md](REFERENCE.md)):
   - `CONTEXT.md`, the domain glossary: complete it when it exists (add,
     sharpen), never remove a term; one term once.
   - `docs/adr/NNNN-<slug>.md`, one per technical choice the code already
     made (framework, language, database, hosting, authentication, branch
     conventions, tests, CI…), numbered after the last existing one; keep
     the existing ADRs as they are, and write no ADR for a choice one of them
     already records.
   - `docs/inventory.md`: the list of the ADRs this pass added, then the apps,
     the routes and screens, the tests and the CI.
6. **Commit and push**, only these files, never on another branch:
   ```bash
   git add CONTEXT.md docs/adr docs/inventory.md
   git commit -m "docs(crewdeck) : inventaire"
   git push origin crewdeck/inventaire
   ```
   `origin` is the repository or the Pilote's folder, whichever the Runner's
   clone comes from: the push lands there as a branch, never on the branch
   checked out in their folder. A push refused is told in your report, never
   forced.
7. **Report**, last: write the report to a file and send it,
   ```bash
   crewdeck-runner etape report --file /tmp/inventory-report.json
   ```
   with `figures` the counts alone, `{ "glossaryTerms": <terms in
   CONTEXT.md>, "technicalChoices": <ADRs this pass added>, "apps": <apps
   listed>, "screens": <routes and screens listed> }`, and `content` a few
   lines for the Pilote: what you found, what you asked, what stays unsure.
   Your turn then ends, and with it the Étape.

## Rules

- **The code's facts only.** Each line of the three files is something a
  file of the code shows; say which one when it is not obvious. No wish, no
  plan, no judgement of the code.
- **Nothing else changes**: no file but the three (and the ADRs), no
  formatting of the code, no fix, however small.
- **No secret, no personal data, no machine path** in what you write, even
  when the code holds one: name the variable, never its value.
- **The Contrat** checks, once your turn ends: `CONTEXT.md` exists and each
  of its terms appears once; at least one ADR, each with its status line;
  `docs/inventory.md` has its sections `Apps`, `Routes and screens`, `Tests
  and CI`; the worktree's HEAD is what the origin holds on
  `crewdeck/inventaire`. Deliver all of it.
