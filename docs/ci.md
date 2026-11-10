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

## The workflow `image`

`.github/workflows/image.yml`, apart from `ci.yml`: a PR to `develop` or
`main` that changes what goes into the server's image or how the VPS runs it
(`apps/server/Dockerfile`, `apps/server/bin/`, `apps/server/package.json`,
`infra/`, the lockfile and workspace, `.dockerignore`, `.mise.toml`, the
workflow itself). A PR that changes only code (`apps/web/src`, …) does not
run it: `ci.yml`'s `build` covers the code. Skipped for drafts like `ci.yml`.
Not a required check: a workflow filtered by paths does not report on every
PR. One job, `image`, 30 minutes, nothing pushed (publishing is `delivery`'s):

1. the Dockerfile's `NODE_VERSION` and `GO_VERSION` equal `.mise.toml`'s;
2. `docker compose config` of `infra/deploy/` (prod, and staging with its
   override) on the templates, completed by `infra/deploy/test/ci.env`, and
   of `infra/edge/`;
3. `caddy validate` of `infra/edge/Caddyfile`;
4. the image built with `CREWDECK_COMMIT`, and refused without it;
5. `infra/deploy/test/image-smoke.sh`: the Runner binaries and their
   `.sha256`, `migrate` and `serve` against a throwaway PostgreSQL (health,
   the page at `/` and `/a-toi`, 404 JSON at `/api/unknown`), the staging
   guard.

```bash
docker build --build-arg CREWDECK_COMMIT=$(git rev-parse HEAD) -t crewdeck-server:local -f apps/server/Dockerfile .
infra/deploy/test/image-smoke.sh crewdeck-server:local
```

[`infra/deploy/README.md`](../infra/deploy/README.md) gives the Compose
commands.

## The workflow `delivery`

`.github/workflows/delivery.yml`, on every push to `develop` and `main`
(ADR 0009, « Delivery »), never cancelled (`delivery-<ref>`). Not a check of
the PRs: it runs after the merge, and its result is the deploy's.

| Push to | Job | What it does |
|---|---|---|
| `develop` | `staging` (environment `staging`) | builds and pushes `ghcr.io/maximed1412/crewdeck-server:<sha>` (GitHub Actions cache) unless it already exists (a re-run redeploys the published image), `deploy staging <sha>` over SSH, then the tag `staged-<sha>` |
| `main` | `production` (environment `production`) | `infra/deploy/ci/production-sha.sh` (a merge commit whose tree is `HEAD^2`'s), the tag `staged-<HEAD^2>` exists, then `deploy production <HEAD^2>`, which refuses `<sha>` unless it is the `staged-` image; nothing is built |

With `DEPLOY_HOST` empty in the environment, both jobs pass with the notice
« VPS pas encore configuré ». The deploy itself, its rollback and how to
redeploy: [`infra/deploy/README.md`](../infra/deploy/README.md), « Livraison ».

```bash
pnpm exec nx test deploy
actionlint .github/workflows/delivery.yml
```

## The workflow `backup-watch`

`.github/workflows/backup-watch.yml`, every day at 07:00 UTC and by hand
(« Run workflow »), never a check of the PRs (ADR 0009, « Backups »). The VPS
sends no mail: GitHub mails the founder when this run fails.

It reads `https://<CREWDECK_DOMAIN>/api/health` (the repository variable
`CREWDECK_DOMAIN`) with curl, then `.github/scripts/backup-watch.mjs` fails
when the response is not the health, has no `backup` (production lacks
`BACKUP_STATUS_FILE`), or its `backup.lastSuccessAt` is `null` or older than
26 h. With `CREWDECK_DOMAIN` empty, it passes with a notice. No secret: the
health is public.

```bash
pnpm exec nx test backup
actionlint .github/workflows/backup-watch.yml
```

The backups themselves: [`infra/backup/README.md`](../infra/backup/README.md).

## The files

| File | What |
|---|---|
| `.github/workflows/ci.yml` | the events, the scope, the concurrency, the check `ci` |
| `.github/workflows/image.yml` | the server's image and the VPS's Compose and Caddy files, on the PRs that change them |
| `.github/workflows/delivery.yml` | the image published and deployed on staging, then promoted to production |
| `.github/workflows/backup-watch.yml` | the age of production's last backup, every morning; its script in `.github/scripts/backup-watch.mjs` |
| `.github/workflows/verify.yml` | the jobs, `on: workflow_call` with `scope` (`affected` \| `full`) and `base` (`origin/develop`) |
| `.github/actions/setup/` | mise, the caches, the dependencies, `nx-set-shas` |
| `.github/actions/browsers/` | Chromium, only when a project in scope uses Playwright |
| `.github/actions/deploy/` | the SSH call to the VPS's restricted key, for `delivery` |
| `.gitleaks.toml` | the secret scan's exceptions, each with its reason |

The actions are pinned by commit SHA, their version in a comment: a moved
tag would run other code with the repository's token.
