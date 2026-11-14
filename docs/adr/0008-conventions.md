# Conventions: contracts, errors, lists, dates, money, scope, front data, tests, language

> **Status:** accepted, 2026-11-10. Amended by [ADR 0014](0014-sign-in-without-github.md)
> (429 for a rate limit).

## Context

Agents implement the tickets without asking. Every cross-cutting choice a
ticket could make differently is settled here, once. Most come from
personal-os's ADR 0030 (contracts and errors) and ADR 0028 (scope opened per
request), proven there with the same agents; the rest from Crewdeck's own
constraints: real time ([ADR 0007](0007-real-time.md)), the Composants
([ADR 0006](0006-skins-and-composants.md)), a Runner in Go
([ADR 0001](0001-shape-of-the-system.md)).

## Decision

### Contracts

- Every schema lives in `packages/contracts` (zod 4), nowhere else: API
  inputs and outputs, events, the Runner protocol, **Contrats**,
  **Composants**. The server validates every input with `nestjs-zod`'s
  global pipe and every output against its schema in tests; OpenAPI is
  generated from them (`/api/docs` outside production). The page imports
  the same schemas; the Runner gets generated Go types.
- JSON in camelCase; database columns in snake_case (`@map`). Ids are
  UUIDv7 strings; the only human numbers are GitHub's (`#42`).

### Routes and errors

- REST under `/api`, English plural kebab-case resources, at most one level
  of nesting (`/api/projects/:id/tickets`). A transition is `POST
  /api/<resource>/:id/<verb>` (`/api/ideas/:id/retain`); a state is never
  set by `PATCH`. Create and update return the resource; delete returns 204.
- One error envelope: `{ "status", "code", "message", "fields"? }`. `code` is
  `<module>.<case>` in English (`loop.runner-offline`); `message` is French,
  shown as is by the page; `fields` maps a field's path to its message.
- Status codes: 400 schema; 401 no session; 404 absent **or another
  Pilote's**; 409 stale state (a command older than the resource's last
  change, during a **Resynchronisation**, or a **Décision** already
  answered); 422 a business rule; 500 only for our faults. No 403: what is
  not yours does not exist.

### Lists

No list is unbounded: a mandatory filter (a **Projet**, a state), a period
(`from`, `to`), or a cursor (`{ items, nextCursor }`, 50 by default) for
what only grows (events, Sessions, statistics' history).

### Dates and time

- Instants are UTC (`timestamptz`), ISO 8601 in JSON (`zInstant`); a day is
  `YYYY-MM-DD` (`zDay`), never converted to an instant.
- The Pilote's time zone (`pilot.timeZone`, from the browser at sign-up,
  editable in the Paramètres) computes what is a day or « every night »:
  **Planifications**, statistics by day.
- The page shows times in the browser's zone with the formatters of
  `@crewdeck/sdk` (`DESIGN.md`, « Copy »).

### Money

- A cost is stored as the provider bills it: integer micro-dollars
  (`zUsdMicros`).
- Shown in euros, as an estimate (PRD, « Pilotage and reports »): converted
  with the ECB reference rate of the spend's day (`fx_rates`, fetched daily
  by the server; the last known rate on a day without one). The API returns
  both (`costUsdMicros`, `costEurCents`); the page shows « 1,80 € » with
  « estimé » where the mockups say so.

### Scope of a Pilote

- Every table of the Pilote's data has `pilotId`. A guard opens the scope
  for each request (from the session cookie, or the Runner's token); a
  Prisma client extension adds `pilotId` to every query of a scoped model
  and throws when a query runs outside a scope. Global tables (`fx_rates`,
  the App's installations index) are an explicit allowlist, checked by a
  test that walks the Prisma models.
- A webhook or a scheduler job opens the scope of the Pilote it concerns
  before touching anything.

### Front data

- One store per Pilote, in `apps/web/src/store/`, fed by the snapshot and
  the events: the whole state of the **Process** the page shows. Pages read
  it through their view function, never through a fetch of their own.
- Content read from GitHub (documents, diffs, captures) goes through
  `@tanstack/query-core`, keyed by repository and commit.
- Commands are one client per resource (`apps/web/src/api/<resource>.ts`),
  typed by the contracts; an error's `message` is shown as is.

### Language

- English for code, comments, routes, schemas, logs, ADRs, AGENTS.md and
  tickets' technical content. French for the UI copy, the error messages,
  the **Contrats**' labels, the commits and the PRs.
- The glossary's terms in code use their identifier from `CONTEXT.md`
  (`AgentLoop`, `Decision`, `AgentSession`), the same in TypeScript and Go.
- The UI copy goes through `t(key, params)` of `@crewdeck/sdk`, with
  English dotted keys (`aToi.empty.title`) and one catalogue
  (`packages/sdk/src/i18n/fr.ts`) at the MVP, so that US-28 is a
  translation. No French string in a Composant's code.
- The page's URLs are French, as the screens' ids: `/a-toi`, `/idees`,
  `/idees/:id`, `/conceptions`, `/boucle`, `/planning`, `/statistiques`,
  `/projets`, `/runner`, `/parametres`, `/parametres/composants`.

### Test baseline

| What | Proves |
|---|---|
| A route | the nominal case matches the output schema; 400 with `fields`; 401 without a session; 404 for another Pilote's resource; 409 where a stale state is possible; 422 for each business rule |
| A module's events | the change and its event are written in one transaction; the event's payload matches its schema |
| A Composant | each of its `examples` renders (Vitest browser mode); each action emits its `cd-action` with a valid payload |
| A screen | Playwright at 390 and 1280 px against the fake Runner and the fake GitHub, axe without violations; the captures of a visual review come from the same tests |
| A Moteur adapter | the recorded streams of `testdata/` replay to the expected normalised events |
| A Contrat rule | one fixture that passes, one that fails with the rule's id |
| A protocol message | the shared fixture is valid in TypeScript and in Go |

Vitest everywhere in TypeScript (the server through `unplugin-swc` for
Nest's decorators), `go test` for the Runner. Integration tests run against
a real PostgreSQL, one throwaway database per run.

## Options that lost

- **RFC 9457 problem details**: the same as personal-os's envelope with
  more fields nobody reads.
- **403 for another Pilote's resource**: it confirms the resource exists.
- **Costs converted at the day's rate when shown**: the same Ticket's cost
  would change every day.
- **Jest for the server** (personal-os's): a second test runner beside the
  browser mode the Composants need.
- **French routes in the API**: the API is code; only the page's URLs are
  UI.

## The first files to imitate

Created by the walking skeleton, then copied by every ticket:
`packages/contracts/src/api/projects.ts`, `apps/server/src/projects/`
(controller, service, its `*.spec.ts` with the route baseline),
`apps/server/src/scope/` (the guard and the Prisma extension),
`apps/web/src/api/projects.ts`, `apps/web/src/views/projets.ts`.
