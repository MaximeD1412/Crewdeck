---
id: INFRA-7
title: "Idempotent provisioning of the VPS (infra/provision/provision.sh), tested twice on throwaway containers in CI"
epic: INFRA
type: chore
priority: P1
size: M
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-5]
adr: [0009]
risques: [OPS-3, SEC-2]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

Crewdeck's VPS holds the GitHub App's private key and, from the Bêta, outside testers' data: it is provisioned by a script, idempotent (run again, it changes nothing and says so), ported from personal-os's (ADR 0009, « Provisioning »). The script prepares what the Compose projects (INFRA-5) and the deploy (INFRA-6) expect; the founder runs it on the ordered VPS in INFRA-10.

## Current state of the code

- Created by INFRA-5: `infra/deploy/` (Compose files expecting the external network `crewdeck-edge` and `/opt/crewdeck/{prod,staging}/.env`), `infra/edge/` (Caddy on 80 and 443).
- No `infra/provision/`.

## To do

- **`infra/provision/provision.sh`** (bash, root, Ubuntu 24.04 LTS; refuses another release with « Ubuntu 24.04 attendu »), variables from the environment or `--admin-user <name> --admin-key <file>`:
  1. admin user with sudo and the given SSH public key;
  2. SSH: `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `AllowUsers <admin> deploy`, validated with `sshd -t` before reload (never locks the session out);
  3. `fail2ban` with the `sshd` jail (5 tries, 1 h);
  4. `ufw`: default deny incoming, allow 22, 80, 443 (TCP) and 443/UDP (HTTP/3);
  5. Docker CE from Docker's apt repository (not `docker.io`), `daemon.json` with `log-driver: local`, and the `DOCKER-USER` chain dropping inbound traffic to published container ports except 80 and 443 (persisted by a systemd unit `crewdeck-docker-user.service` run after `docker.service`);
  6. `unattended-upgrades` for security updates, automatic reboot off;
  7. the tree `/opt/crewdeck/{deploy,prod,staging,edge,backup}` (mode 750, group `docker`), the network `docker network create crewdeck-edge` when absent;
  8. a summary: each step prints « déjà fait » or « appliqué : <what> », and the last line is « rien à changer » when every step was already done.
- **Tests** (`infra/provision/src/*.spec.ts`, Vitest, Nx project `provision`, target `test-integration`): a throwaway `ubuntu:24.04` container with systemd (`jrei/systemd-ubuntu:24.04` or an image built from `infra/provision/test/Dockerfile`), the script run twice: the first run applies, the second prints « rien à changer » and changes no file under `/etc` (checksums compared); specs per concern as in personal-os (`provision.ssh.spec.ts`: password login refused, root refused; `provision.firewall.spec.ts`: ufw rules, `DOCKER-USER` drops a published port 5432; `provision.docker.spec.ts`: Docker CE from Docker's repository, network `crewdeck-edge`; `provision.idempotence.spec.ts`).
- **`.github/workflows/provision.yml`**: on pull requests and pushes that change `infra/provision/**`, runs `pnpm exec nx test-integration provision`.
- `infra/provision/README.md` (French): prerequisites, the command to run from the founder's machine (`ssh root@<ip> 'bash -s' -- --admin-user … < infra/provision/provision.sh` or after `scp`), what each step does, how to rerun it.

## Decisions already made

- Port of personal-os's `infra/provision/provision.sh` and its specs (repository `MaximeD1412/personal-os`), minus what is personal-os's own (Authentik, homelab).
- The user `deploy` and its forced-command keys are INFRA-6's `install-access.sh`, run after provisioning; `AllowUsers` already names it.
- No configuration management tool (Ansible): one script the founder can read.

## Acceptance criteria

- [ ] On a fresh Ubuntu 24.04 container, the first run applies every step; the second prints « rien à changer » and leaves `/etc` unchanged.
- [ ] After provisioning, SSH with a password is refused and with the admin key accepted; root cannot log in.
- [ ] A container publishing port 5432 is not reachable from outside the host; 80 and 443 are.
- [ ] On Ubuntu 22.04 the script stops at once with « Ubuntu 24.04 attendu ».
- [ ] `provision.yml` runs on a PR that changes `infra/provision/provision.sh` and not otherwise.

## Verification

- `pnpm exec nx test-integration provision`
- `shellcheck infra/provision/provision.sh`
- `actionlint .github/workflows/provision.yml`

## For prod

Nothing (the run on the real VPS is INFRA-10).

## Out of scope

- Ordering the VPS and running the script: INFRA-10. Backups: INFRA-8. The `deploy` user: INFRA-6.

## Dependencies

- INFRA-5.
