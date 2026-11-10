---
id: INFRA-12
title: "Secrets and environments: DNS, the VPS's env files, VAPID and token keys, deploy keys, GitHub environments, first staging deploy"
epic: INFRA
type: externe
priority: P1
size: S
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-6, INFRA-10, INFRA-11]
adr: [0002, 0007, 0009]
risques: [SEC-2]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

Everything the code needs from outside is in templates (INFRA-5) and the deploy waits for its keys (INFRA-6); the VPS exists (INFRA-10) and the Apps too (INFRA-11). This ticket is the founder's gesture that turns them on: values are never committed (ADR 0009, « Secrets »), each secret has its second copy in the password manager (design journal, cross review).

## Current state of the code

- Created by INFRA-5: `infra/deploy/prod.env.example`, `staging.env.example`, `infra/edge/edge.env.example`, `infra/deploy/README.md`.
- Created by INFRA-6: `.github/workflows/delivery.yml` (secret `DEPLOY_SSH_KEY`, variables `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS` per environment), `infra/deploy/bin/install-access.sh`, `deploy.sh` (reads `/opt/crewdeck/deploy/ghcr.env`).
- Created by INFRA-8 (if merged): `backup-watch.yml` reading the variable `CREWDECK_DOMAIN`.

## To do

Gestures of the founder, in order (`<domain>` from BIZ-1):

- [ ] **DNS** at the registrar: `A` and `AAAA` for `<domain>` and `staging.<domain>` to the VPS (INFRA-10); TTL 300 until the first deploy works.
- [ ] **Edge**: on the VPS, `/opt/crewdeck/edge/.env` from `edge.env.example` (`CREWDECK_DOMAIN`, `ACME_EMAIL`), copy `infra/edge/` there, `docker compose up -d`; `https://staging.<domain>` answers (502 until the server runs, with a valid certificate).
- [ ] **Keys to generate** (each also stored in the password manager, entry « Crewdeck <env> »):
  - `POSTGRES_PASSWORD` (`openssl rand -hex 24`), `SESSION_SECRET` (`openssl rand -hex 32`), `GITHUB_TOKEN_KEY` (`openssl rand -base64 32`), one set per environment;
  - VAPID keys per environment (`npx web-push generate-vapid-keys`), `VAPID_SUBJECT=https://<domain>`.
- [ ] **Env files** on the VPS: `/opt/crewdeck/prod/.env` and `/opt/crewdeck/staging/.env` from the templates, mode 600, owner `deploy`, with the App of each environment (INFRA-11: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` = `base64 -w0 <file>.pem`, `GITHUB_WEBHOOK_SECRET`); staging's `PROD_PUBLIC_URL=https://<domain>` and `PROD_GITHUB_APP_ID`.
- [ ] **GHCR**: a fine-grained token (or classic with `read:packages` only) in `/opt/crewdeck/deploy/ghcr.env` (`GHCR_USER`, `GHCR_TOKEN`), mode 600.
- [ ] **Deploy keys**: two ed25519 key pairs (`ssh-keygen -t ed25519 -N '' -f crewdeck-deploy-<env>`); on the VPS `sudo infra/deploy/bin/install-access.sh --staging-key … --production-key …` with the public keys.
- [ ] **GitHub environments** (repository Settings > Environments): `staging` (deployment branches: `develop` only) and `production` (`main` only, required reviewer: none), each with the secret `DEPLOY_SSH_KEY` (its private key), the variables `DEPLOY_HOST` (the VPS's IPv4) and `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 <ip>`). Repository variable `CREWDECK_DOMAIN=<domain>`. Then delete the private keys from the machine (they live in GitHub and the password manager).
- [ ] **First staging deploy**: rerun the last `delivery.yml` run on `develop` (or push to `develop`); check `https://staging.<domain>/api/health` returns that commit, and the « Crewdeck staging » App's last webhook delivery is 2xx once PROJET-1 is merged.
- [ ] Update `docs/pilotage/mep.json` items of INFRA-5, INFRA-6, INFRA-11 as done (a PR, or ask an agent).
- [ ] Comment on this ticket: done, the date, nothing secret.

## Decisions already made

- Production is deployed only by the first `develop` → `main` merge after this; no manual `docker compose up`.
- Each environment has its own keys: a staging key never opens production.

## Acceptance criteria

- [ ] `https://staging.<domain>/api/health` returns `status: ok` with the commit of `develop`'s head, after a push.
- [ ] `ssh -i <staging key> deploy@<ip> deploy production <sha>` is refused.
- [ ] Every secret above exists in the password manager and in exactly one place on the VPS or in GitHub.

## Verification

- `curl -fsS https://staging.<domain>/api/health`
- The `delivery.yml` run of `develop`'s head is green.

## For prod

This ticket is the release's gestures; `docs/pilotage/mep.json` updated as above.

## Out of scope

- The restic repository: INFRA-13. Promoting to production: the first `develop` → `main` merge.

## Dependencies

- INFRA-6.
- INFRA-10.
- INFRA-11.
