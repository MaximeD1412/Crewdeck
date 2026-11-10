---
id: INFRA-13
title: "Create the restic repository at another provider than OVH, keep its password, enable the nightly backup"
epic: INFRA
type: externe
priority: P2
size: S
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-8, INFRA-10]
adr: [0009]
risques: [OPS-2]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0009: backups go to another provider, their password and credentials are on the VPS and in the founder's password manager, never in GitHub, so losing the VPS does not lose the backups. The scripts are INFRA-8's; creating the bucket and the repository is a purchase and a secret only the founder handles.

## Current state of the code

- Created by INFRA-8: `infra/backup/bin/{backup.sh,rehearse.sh,restore-check.sh,install.sh}`, the systemd units, `infra/backup/README.md` (the expected `/opt/crewdeck/backup/restic.env`).

## To do

- [ ] Create an S3-compatible bucket at a provider other than OVH (Backblaze B2 or Scaleway Object Storage, EU region), private, with object lock off; an access key restricted to that bucket.
- [ ] Generate the restic password (`openssl rand -base64 32`); store it, the bucket URL and the access key in the password manager, entry « Crewdeck backups ».
- [ ] On the VPS: `/opt/crewdeck/backup/restic.env` (mode 600, root: `RESTIC_REPOSITORY=s3:<endpoint>/<bucket>`, `RESTIC_PASSWORD_FILE=/opt/crewdeck/backup/restic.password`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) and the password file (mode 600); `restic init`.
- [ ] Run `sudo infra/backup/bin/install.sh`, then `sudo systemctl start crewdeck-backup.service` once and check `restic snapshots` lists one `prod` snapshot (needs production deployed at least once; otherwise run it after the first production deploy).
- [ ] From the founder's machine, `infra/backup/bin/restore-check.sh --env <local env file>`: it prints the snapshot's date. Keep that local env file in the password manager, not on disk.
- [ ] Add a monthly reminder (calendar) for `restore-check.sh`.
- [ ] Comment on this ticket: provider, region, date of the first restore check; nothing secret.

## Decisions already made

- Not OVH: one provider's outage or account issue must not take the VPS and its backups together.
- No GitHub secret for restic, by ADR 0009.

## Acceptance criteria

- [ ] The nightly timer is enabled on the VPS and a `prod` snapshot exists.
- [ ] A restore check from the founder's machine succeeded.
- [ ] `backup-watch.yml` is green the next morning.

## Verification

- `sudo systemctl list-timers crewdeck-backup.timer` and `restic snapshots --tag prod` on the VPS.

## For prod

`docs/pilotage/mep.json`: the restic repository done, the monthly restore check listed.

## Out of scope

- The scripts: INFRA-8.

## Dependencies

- INFRA-8.
- INFRA-10.
