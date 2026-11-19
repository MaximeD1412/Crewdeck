# The official Skills

The Skills the Runner embeds and mounts in an Étape's Session (ADR 0004,
RUNNER-12). The Runner mounts the Session's Skill alone: for Claude Code, a
plugin `crewdeck` (`--plugin-dir`) whose `skills/<skill>/`; for Codex, its
`CODEX_HOME/skills/<skill>/`.

## One folder per Skill

A folder is named as the `skill` of its Étape in the catalogue
(`packages/contracts/src/process/catalogue.ts`):

| Folder | Étape |
|---|---|
| `idea-analysis` | Analyse de l'Idée |
| `inventory` | Inventaire |
| `product-design` | PRD |
| `visual-design` | Maquettes |
| `technical-design` | Conception technique |
| `cross-review` | Revue croisée |
| `plan-backlog` | Découpage en Tickets |
| `code` | Code |
| `review` | Review |

It holds its `SKILL.md`, a front matter with its `name` (the folder's) and
its `description`, and what the Skill reads beside it (references, examples).
Only a folder with a `SKILL.md` is a Skill: the embedded files show nothing
else (`skills.FS`). A Skill written for an Étape of the catalogue is checked
by `skills_test.go`; one the catalogue names and that is not written yet is
only listed by it.

## The Étape: `crewdeck-runner etape`

The Session's first message names its Skill and its StepRun. The Skill talks
to the Runner through `crewdeck-runner etape`, which the Session's shims put
first in its PATH:

- `crewdeck-runner etape start`, first: the StepRun is `running`; it prints
  the Étape's context as JSON (`stepRunId`, `stepKind`, `skill`, `contractId`,
  `projectId`, `origin`, `branch`, `base`, `inputs`, each Entrée with the
  reference of its Artefact or `null`).
- `crewdeck-runner etape ask --question '<json>'`: a question to the Pilote,
  `{ "title": "…", "options": [{ "label": "…", "detail": "…" }], "multiple":
  false }`; it waits for the answer and prints it, `{ "text": "…" }` or
  `{ "options": ["…"] }`. Cut before the answer (a tool's timeout), it waits
  again with `crewdeck-runner etape ask --wait <requestId>`, the id it printed
  on stderr.
- `crewdeck-runner etape report --file <path>` (or `-`, standard input), last:
  `{ "figures": { … }, "content": "…" }`. `figures` are what the server may
  read (ids, states, counts), checked against the report of the Étape's kind;
  `content` is the report's free text, sealed by the Runner before it leaves
  the machine, never in `figures`.

The end of the agent's turn is the end of the Étape: the Runner then ends
the Moteur (Claude Code, which waits for its next message, has its input
closed), unless the Pilote interrupted the turn. A Skill asks only through
`etape ask`, inside its turn.

The Contrat of the Étape is checked by the Runner once the Session ended, on
its worktree and its change of code read from the Miroir: a Skill does not
check it, it delivers what the Contrat asks.

## Read and write through `mirror`

A Skill reads the Tickets, the PRs and the documents through the Miroir, the
Runner's copy (ADR 0010), and writes through it too, never with `gh`:

- reads: `mirror issue view <n> --json title,body,labels`, `mirror pr view
  <n> --json …`, `mirror ready`, `mirror search "<text>"`;
- writes: `mirror issue create|edit|comment|close|reopen`, `mirror pr
  create|edit|comment|close|reopen|review` (MIROIR-7).

`skills_test.go` fails on an embedded Markdown file that calls `gh`
outside `mirror`, whatever its command (`gh api …` among them) and its
options before or after it (`gh -R <owner>/<repo> issue view …`); or that
calls `mirror gh` with anything but a read of `issue|pr`
(`view|list|diff|checks|status`, an explicit list): a write (`merge`,
`delete`, `create`…, options before the verb included), an unknown verb,
`api` or another command.
