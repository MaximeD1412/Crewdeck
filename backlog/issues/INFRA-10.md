---
id: INFRA-10
title: "Order the OVH VPS for Crewdeck and run the provisioning on it"
epic: INFRA
type: externe
priority: P1
size: S
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-7]
adr: [0009]
risques: [OPS-3]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0009: one OVH VPS dedicated to Crewdeck, in the EU, sharing no machine with the founder's personal data (the GitHub App's private key and outside testers' data live there). Ordering it is a purchase only the founder can make; then the provisioning script of INFRA-7 runs on it.

## Current state of the code

- Created by INFRA-7: `infra/provision/provision.sh` and its README (the exact command to run).
- Created by INFRA-5: `infra/deploy/README.md` (the layout `/opt/crewdeck/…`).

## To do

Gestures of the founder, in order:

- [ ] Order an OVH VPS: Ubuntu 24.04 LTS, EU datacenter (Gravelines, Roubaix or Strasbourg), at least 4 vCPU, 8 GB RAM, 80 GB SSD (two Compose projects, two PostgreSQL, Caddy, the migration rehearsals of INFRA-8). Monthly billing.
- [ ] At the order, give the founder's SSH public key (no root password by email).
- [ ] Note in the password manager, entry « Crewdeck VPS »: IPv4, IPv6, the OVH order id, the admin user name.
- [ ] From the founder's machine, run `infra/provision/provision.sh` as its README says, with `--admin-user` and the founder's key; run it a second time and check the last line « rien à changer ».
- [ ] Check: `ssh root@<ip>` refused, `ssh <admin>@<ip>` accepted, `sudo ufw status` shows 22, 80, 443.
- [ ] Enable OVH's automated snapshot option only if it is free (the backups are INFRA-8's restic, this is not a substitute).
- [ ] Comment on this ticket: the IPv4 (not secret), the datacenter, the date.

## Decisions already made

- OVH, as ADR 0009 says; not the personal-os VPS (ADR 0009, « Options that lost »).
- The VPS's IP goes into the GitHub variable `DEPLOY_HOST` in INFRA-12, not now.

## Acceptance criteria

- [ ] The VPS answers SSH with the admin key only; the second provisioning run says « rien à changer ».
- [ ] The network `crewdeck-edge` and the tree `/opt/crewdeck/` exist on it.

## Verification

- `ssh <admin>@<ip> 'docker network ls | grep crewdeck-edge && ls /opt/crewdeck'`

## For prod

The VPS itself: listed in `docs/pilotage/mep.json` as done, with its datacenter.

## Out of scope

- DNS records, secrets, deploy keys, first deploy: INFRA-12.

## Dependencies

- INFRA-7.
