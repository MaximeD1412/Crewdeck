# CI

The gate the Boucle reads before merging a Ticket (US-15): ADR 0009,
« CI », says why; this page says what runs and how to run the same thing
locally.

## When it runs

`.github/workflows/ci.yml`:

| Event | What runs | Scope |
|---|---|---|
| PR to `develop`, as a draft | nothing: no job, no check | — |
| PR to `develop`, ready (`opened`, `synchronize`, `reopened`, `ready_for_review`) | `verify.yml`, then `ci` | `affected` |
| PR to `main` | `verify.yml`, then `ci` | `full` |
| Push to `develop` (a merge) | `verify.yml`, then `ci` | `affected` |

The Boucle opens its PRs as drafts and marks them ready after its review:
`ready_for_review` runs the checks on the head SHA, where the Boucle reads
them (BOUCLE-4). A PR pushed again cancels its previous run; a push to
`develop` never cancels another.

- **`affected`**: `nx affected` between the PR's merge base and its head, or,
  on a push, since the last successful run of `ci.yml` on `develop`
  (`nrwl/nx-set-shas`): a red run's changes are checked again by the next
  one. What a PR's scope skips, the nightly (INFRA-9) runs the next night.
- **`full`**: `nx run-many`, every project.

No Nx Cloud, no remote cache: the pnpm store, the Go modules and builds, the
mise tools and the Playwright browsers are cached by GitHub's cache.

## The required check « ci »

Branch protection of `develop` and `main` requires one check, the job `ci`
of `ci.yml`. It runs after `gate` (the call to `verify.yml`) whatever its
result, and is green only when every job of `verify.yml` is: red when one is
red or cancelled. New jobs in `verify.yml` need no change in the branch
protection. On a draft, `ci` is skipped with `gate`.

## The jobs of `verify.yml`

In parallel, 20 minutes each, read-only token.

### `secrets`

gitleaks with `.gitleaks.toml` (the default rules plus two exceptions: the
path `packages/contracts/fixtures/crypto/`, the encryption test vectors, and
the values `secret-<words>-<4 hex>`, the fakes of the log redaction test):

1. refuses a `.gitleaksignore` and inline allow comments: an exception is
   written in `.gitleaks.toml`, where it is reviewed;
2. `gitleaks/gitleaks-action` on the event's commits;
3. a second pass on the whole range (`base..head` of the PR, `before..after`
   of the push), merges included: the action reads only 30 commits;
4. checks the scan still reports a fake `ghp_` token made on the fly.

Locally, on your branch:

```bash
gitleaks git . --config .gitleaks.toml --log-opts="--diff-merges=first-parent origin/develop..HEAD"
```

### `checks`

The toolchain of `.mise.toml` (`jdx/mise-action`), `pnpm install
--frozen-lockfile`, Chromium when a Composant's test runs in a browser, then:

```bash
pnpm exec nx affected -t lint typecheck test build --base=origin/develop   # full: nx run-many -t …
pnpm exec nx run contracts:generate && git status --porcelain -- packages/contracts/generated apps/runner/internal/contracts
```

The second line fails with « Contrats générés pas à jour : lance pnpm exec
nx run contracts:generate » when a schema changed without its JSON Schema or
Go types: run it and commit what it writes.

### `integration`

A `postgres:18` service (`crewdeck` / `crewdeck`) in `DATABASE_URL`; each
run creates its own database and drops it.

```bash
pnpm db:up
pnpm exec nx affected -t test-integration --base=origin/develop
```

Locally, run only the files you touched
(`pnpm exec nx test-integration server -- ideas`): AGENTS.md « Checking ».

### `e2e`

The projects in scope with an `e2e` target (`apps/web`, INFRA-4), against
the same PostgreSQL service, Chromium from the Playwright cache (keyed by its
version). On failure, `apps/web/test-results/` is kept 7 days as the
artifact `e2e-results`. With no `e2e` target in scope, the job installs no
browser and passes.

```bash
pnpm exec nx e2e web -- a-toi.spec.ts
```

## The files

| File | What |
|---|---|
| `.github/workflows/ci.yml` | the events, the scope, the concurrency, the check `ci` |
| `.github/workflows/verify.yml` | the jobs, `on: workflow_call` with `scope` (`affected` \| `full`) and `base` (`origin/develop`) |
| `.github/actions/setup/` | mise, the caches, the dependencies, `nx-set-shas` |
| `.github/actions/browsers/` | Chromium, only when a project in scope uses Playwright |
| `.gitleaks.toml` | the secret scan's exceptions, each with its reason |

The actions are pinned by commit SHA, their version in a comment: a moved
tag would run other code with the repository's token.
