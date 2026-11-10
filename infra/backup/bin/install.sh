#!/usr/bin/env bash
# Installs the backups on the VPS (ADR 0009, « Backups »), run as root from a
# checkout of the repository, once the restic repository exists and
# /opt/crewdeck/backup/restic.env is written (INFRA-13), and again after any
# change of infra/backup/:
#
#   install.sh
#
# - bin/backup.sh to /opt/crewdeck/backup/bin/, bin/rehearse.sh to
#   /opt/crewdeck/deploy/bin/ (where deploy.sh calls it), owned by root;
# - /opt/crewdeck/backup/status/, where backup.sh writes last-success, which
#   production's server reads through a read-only bind mount;
# - restic.env and its password file owned by `deploy`, mode 600: the
#   rehearsal runs as `deploy`, inside deploy.sh; the backup runs as root;
# - the units crewdeck-backup.service and crewdeck-backup.timer, the timer
#   enabled.
#
# Idempotent. Needs restic >= 0.17 (--stdin-from-command) and the user
# `deploy` (infra/deploy/bin/install-access.sh).
set -euo pipefail

: "${CREWDECK_ROOT:=/opt/crewdeck}"
: "${UNIT_DIR:=/etc/systemd/system}"
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
backup_dir="$CREWDECK_ROOT/backup"
env_file="$backup_dir/restic.env"

die() {
  echo "install.sh : $*" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || die "à lancer en root"

version=$(restic version 2>/dev/null | sed -n 's/^restic \([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p') || true
[ -n "$version" ] || die "restic introuvable : installer restic >= 0.17 (infra/backup/README.md)"
read -r major minor <<<"$version"
[ "$major" -gt 0 ] || [ "$minor" -ge 17 ] ||
  die "restic $major.$minor trop ancien : >= 0.17 requis pour --stdin-from-command (infra/backup/README.md)"

id deploy >/dev/null 2>&1 || die "l'utilisateur deploy n'existe pas : lancer d'abord infra/deploy/bin/install-access.sh"

[ -r "$env_file" ] || die "$env_file absent : le copier depuis infra/backup/restic.env.example et le remplir (INFRA-13)"
password_file=$(sed -n 's/^RESTIC_PASSWORD_FILE=//p' "$env_file" | tail -1)
grep -q '^RESTIC_REPOSITORY=.' "$env_file" || die "RESTIC_REPOSITORY manquant dans $env_file"
[ -n "$password_file" ] && [ -r "$password_file" ] || die "RESTIC_PASSWORD_FILE manquant ou illisible dans $env_file"

install -d -m 755 "$backup_dir/bin" "$backup_dir/status" "$CREWDECK_ROOT/deploy/bin"
install -m 755 "$SOURCE/bin/backup.sh" "$backup_dir/bin/backup.sh"
install -m 755 "$SOURCE/bin/rehearse.sh" "$CREWDECK_ROOT/deploy/bin/rehearse.sh"
chown root:root "$backup_dir/bin" "$backup_dir/bin/backup.sh" "$backup_dir/status" "$CREWDECK_ROOT/deploy/bin/rehearse.sh"

for secret in "$env_file" "$password_file"; do
  chown deploy:deploy "$secret"
  chmod 600 "$secret"
done

install -m 644 "$SOURCE/systemd/crewdeck-backup.service" "$SOURCE/systemd/crewdeck-backup.timer" "$UNIT_DIR/"
systemctl daemon-reload
systemctl enable --now crewdeck-backup.timer

echo "sauvegardes installées ; prochaine exécution :"
systemctl list-timers crewdeck-backup.timer --no-pager || true
