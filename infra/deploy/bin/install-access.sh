#!/usr/bin/env bash
# The restricted access through which GitHub Actions deploys (ADR 0009,
# « Delivery »), run once as root by INFRA-12, from a checkout of the
# repository, and again whenever a key or a script of infra/deploy/bin/
# changes:
#
#   install-access.sh --staging-key <file.pub> --production-key <file.pub> [--print]
#
#   --print   prints the authorized_keys it would write, touches nothing
#
# - the user `deploy`, member of `docker`, without a password;
# - infra/deploy/bin/ copied to /opt/crewdeck/deploy/bin/, owned by root;
# - ~deploy/.ssh/authorized_keys, owned by root, one line per environment:
#     command="/opt/crewdeck/deploy/bin/deploy-trigger <env>",restrict <key>
#   `restrict` forbids forwarding, the PTY and X11; the forced command only
#   accepts `deploy <env> <sha>` (deploy-trigger);
# - /opt/crewdeck/{prod,staging} and their .env, and deploy/ghcr.env, owned by
#   `deploy`, which writes CREWDECK_SHA and current-sha.
#
# Idempotent: authorized_keys is rewritten whole, so replacing a key and
# running it again removes the old one.
set -euo pipefail
# A key refused inside $(…) stops the script, not only the substitution.
shopt -s inherit_errexit

USER_NAME=deploy
HOME_DIR=/home/deploy
CREWDECK_ROOT=/opt/crewdeck
PREFIX="$CREWDECK_ROOT/deploy"
TRIGGER="$PREFIX/bin/deploy-trigger"
# Tells our user from a `deploy` another project of the machine created, whose
# keys are never rewritten.
GECOS="Crewdeck, deploiement pousse (ADR 0009)"

die() {
  echo "install-access.sh : $*" >&2
  exit 1
}

staging_key=""
production_key=""
print=0
while [ $# -gt 0 ]; do
  case "$1" in
    --staging-key)
      staging_key="${2-}"
      shift
      ;;
    --production-key)
      production_key="${2-}"
      shift
      ;;
    --print) print=1 ;;
    -h | --help)
      sed -n '2,21p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) die "argument inconnu : $1" ;;
  esac
  shift
done
[ -n "$staging_key" ] && [ -n "$production_key" ] ||
  die "usage : install-access.sh --staging-key <fichier.pub> --production-key <fichier.pub> [--print]"

# --- The keys ---------------------------------------------------------------

TYPES='ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com|ssh-rsa'

# Prints `<type> <body>` of a public key file, without its comment. A file with
# anything else than one bare key is refused: options in front of the key or a
# second line would become an authorized_keys entry without a forced command,
# that is a shell.
bare_key() {
  local file="$1" content
  [ -r "$file" ] || die "$file illisible"
  content=$(tr -d '\r' <"$file" | grep -v '^[[:space:]]*$' || true)
  [ -n "$content" ] || die "$file est vide"
  [ "$(printf '%s\n' "$content" | wc -l)" -eq 1 ] || die "$file contient plusieurs lignes : une seule clé publique attendue"
  [[ "$content" =~ ^($TYPES)\ ([A-Za-z0-9+/]+={0,2})(\ .*)?$ ]] ||
    die "$file n'est pas une clé publique nue (type, corps, commentaire), sans option devant"
  local key="${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
  ssh-keygen -l -f /dev/stdin <<<"$key" >/dev/null 2>&1 || die "$file : ssh-keygen ne reconnaît pas cette clé"
  printf '%s' "$key"
}

staging=$(bare_key "$staging_key")
production=$(bare_key "$production_key")
[ "$staging" != "$production" ] || die "la même clé pour staging et production : une clé par environnement"

authorized_keys() {
  echo "# Written by infra/deploy/bin/install-access.sh (ADR 0009): never edit by hand."
  echo "# Each key can only run deploy-trigger for its own environment."
  echo "command=\"$TRIGGER staging\",restrict $staging crewdeck-deploy-staging"
  echo "command=\"$TRIGGER production\",restrict $production crewdeck-deploy-production"
}

if [ "$print" = 1 ]; then
  authorized_keys
  exit 0
fi

# --- The installation, as root ------------------------------------------------

[ "$(id -u)" = 0 ] || die "à lancer en root"
for tool in useradd usermod install getent; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool absent de la machine"
done
getent group docker >/dev/null || die "le groupe docker n'existe pas : Docker est-il installé (INFRA-7) ?"

# The shell is /bin/sh, not /usr/sbin/nologin: sshd runs the forced command
# through the user's shell (`<shell> -c <command>`), and nologin would refuse
# it. No shell is reachable for all that: no password, and every key of
# authorized_keys forces deploy-trigger.
if getent passwd "$USER_NAME" >/dev/null; then
  [ "$(getent passwd "$USER_NAME" | cut -d: -f5)" = "$GECOS" ] ||
    die "un utilisateur $USER_NAME existe déjà sans être celui de Crewdeck : rien n'est touché"
  usermod --shell /bin/sh --home "$HOME_DIR" "$USER_NAME"
else
  useradd --system --user-group --no-create-home --home-dir "$HOME_DIR" \
    --shell /bin/sh --comment "$GECOS" "$USER_NAME"
  echo "utilisateur $USER_NAME créé"
fi
# `*` rather than a locked account (`!`): without PAM, sshd also refuses the
# keys of a locked account.
usermod --password '*' --append --groups docker "$USER_NAME"

# The home and its keys belong to root: deploy can neither add a key nor drop
# the forced command of its own. ~/.docker is deploy's, for `docker login`.
install -d -o root -g root -m 755 "$HOME_DIR" "$HOME_DIR/.ssh"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 700 "$HOME_DIR/.docker"

# The scripts belong to root: deploy runs them, never rewrites them.
# rehearse.sh, installed there by INFRA-8, is left alone.
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -d -o root -g root -m 755 "$PREFIX" "$PREFIX/bin"
for script in "$source_dir"/*; do
  install -o root -g root -m 755 "$script" "$PREFIX/bin/"
done

# What the deploy writes: CREWDECK_SHA in the env files, current-sha next to
# them; and what it reads alone: the registry token.
for env_dir in "$CREWDECK_ROOT/prod" "$CREWDECK_ROOT/staging"; do
  install -d -o "$USER_NAME" -g docker -m 750 "$env_dir"
done
for file in "$CREWDECK_ROOT/prod/.env" "$CREWDECK_ROOT/staging/.env" "$PREFIX/ghcr.env"; do
  if [ -e "$file" ]; then
    chown "$USER_NAME:$USER_NAME" "$file"
    chmod 600 "$file"
  else
    echo "$file absent : à écrire depuis son modèle (INFRA-12)"
  fi
done

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
authorized_keys >"$tmp"
install -o root -g root -m 644 "$tmp" "$HOME_DIR/.ssh/authorized_keys"
echo "accès de déploiement posé : 2 clés dans $HOME_DIR/.ssh/authorized_keys"
