# inventory reference

## Glossary (`CONTEXT.md`)

A glossary, not a specification: the domain's words, no implementation. The
terms and their definitions are in the product's language (the UI's); each
gives its code identifier, as the code spells it.

```md
# <Product>

<One or two sentences: what the product is.>

This document is a glossary, not a specification. <Language convention: the
UI's language, the code identifiers' language.>

## Language

### <Cluster of terms>

**Order** (`Order`):
What it IS, in one or two sentences, with the related terms in bold and
their cardinality ("an **Order** has one or more **Lines**").
_Avoid_: purchase, transaction

## Flagged ambiguities

- "account" meant both **Customer** and **User** in the code: see each term.
```

- One line `**Term** (`Identifier`):` per term, at the line's start, once in
  the whole file (the Contrat counts them; a second line for the same term
  fails it). Elsewhere, a term in bold is never followed by ` (`.
- **Be opinionated**: one word per concept, the others under _Avoid_ (what
  the code or its UI also says for it).
- **Tight definitions**: what it is, not what it does; one or two sentences.
- **Only the project's concepts**: no general programming terms (no
  "component", "service", "endpoint").
- **Group** the terms under `###` subheadings when clusters appear.
- An existing `CONTEXT.md` keeps its terms, its order and its wording; add
  yours in its clusters, and an ambiguity you found under « Flagged
  ambiguities ».

## Technical choice (`docs/adr/NNNN-<slug>.md`)

Four digits, the highest number in `docs/adr/` plus one (`0001` when there
is none), a slug from the title in kebab case. One choice per file.

```md
# <Short title of the choice>

> **Status:** accepted, recorded from the code, <YYYY-MM-DD>.

## Context

<What the code had to answer: the need, the constraint it shows.>

## Decision

<What the code chose, and where it shows (the files, the manifests).>

## Consequences

<What follows for whoever changes the code: what it locks in, the conventions
it brings, what stays unsure.>
```

- The status line is exactly `> **Status:** accepted, recorded from the
  code, ` and today's date (`date +%F`), on its own line: the Contrat checks
  each ADR has it.
- **Write one** for a choice that is hard to reverse or that a newcomer
  would not guess: the architecture's shape, a framework, a language, a
  database, an ORM, hosting and deploy, authentication, the branch and
  release conventions, how tests are written, the CI. Not for a library a
  single file uses.

## The inventory (`docs/inventory.md`)

```md
# Inventory

- [0004 Next.js for the web app](adr/0004-web-framework.md)
- [0005 PostgreSQL through Prisma](adr/0005-database.md)

## Apps

- `apps/web`: <what it is, its framework>.

## Routes and screens

- `/`: <what the screen shows>.
- `GET /api/orders`: <what it answers>.

## Tests and CI

- <Each kind of test: its tool, where the files are, the command.>
- <The CI: its file, what it runs and when.>
```

- The first list holds each ADR this pass added, and only those, as
  `- [NNNN <title>](adr/NNNN-<slug>.md)`: the page reads the ADRs to approve
  from it, never from the folder.
- The three `##` sections are there even when one is short (a library has no
  screen: « None: a library. »).
- `screens` in the report counts the lines of « Routes and screens », `apps`
  those of « Apps ».
