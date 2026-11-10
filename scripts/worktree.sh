#!/usr/bin/env bash
# Prépare et nettoie le worktree d'une session d'agent, frère du dépôt
# principal (../Crewdeck-<branche>), pour agent-loop et le Runner
# (`agentLoop.setupCmd` et `dropCmd` de .process.json, ADR 0009).
#
#   scripts/worktree.sh setup   dans le worktree, après `git worktree add`
#   scripts/worktree.sh drop    dans le worktree, avant `git worktree remove`
#
# Pas de base par worktree : chaque exécution des tests d'intégration crée la
# sienne dans le PostgreSQL partagé et la supprime
# (apps/server/test/integration/database.ts). Le dépôt principal n'est jamais
# modifié, aucun fichier suivi n'est copié.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage : scripts/worktree.sh setup|drop

  setup   dans un worktree, après `git worktree add` : copie les .env* non
          suivis du dépôt principal, installe les outils et les dépendances,
          vérifie le PostgreSQL partagé
  drop    dans un worktree, avant `git worktree remove` : arrête le démon Nx,
          supprime les sorties et les bases d'intégration laissées par ce
          worktree
EOF
  exit 2
}

fail() {
  echo "ÉCHEC : $*" >&2
  exit 1
}

# step <message> <commande>… : lance une étape, n'affiche sa sortie qu'en cas
# d'échec, et sort alors avec le message.
step() {
  local message=$1 out
  shift
  out=$("$@" 2>&1) || {
    [[ -z $out ]] || echo "$out" >&2
    fail "$message"
  }
}

cmd=${1:-}
[[ $cmd == setup || $cmd == drop ]] || usage

root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "à lancer dans un worktree du dépôt"
# Le dépôt principal : la première entrée de `git worktree list`.
main=$(git -C "$root" worktree list --porcelain | sed -n '1s/^worktree //p')
[[ $root != "$main" ]] || fail "à lancer dans un worktree, pas dans le dépôt principal ($main)"
cd "$root"

setup() {
  # 1. Les .env* non suivis du dépôt principal (ignorés ou non), sans écraser
  # ceux du worktree.
  local rel
  while IFS= read -r rel; do
    [[ -n $rel ]] || continue
    if [[ -e $root/$rel ]]; then
      echo "ok   $rel déjà présent, laissé tel quel"
      continue
    fi
    mkdir -p "$(dirname "$root/$rel")"
    step "copie de $rel depuis le dépôt principal" cp "$main/$rel" "$root/$rel"
    echo "ok   $rel copié depuis le dépôt principal"
  done < <({
    git -C "$main" ls-files --others --exclude-standard -- '.env*'
    git -C "$main" ls-files --others --ignored --exclude-standard -- '.env*'
  } | sort -u)

  # 2. Les versions de .mise.toml, puis leur PATH pour la suite : le shell qui
  # lance ce script n'a pas forcément activé mise.
  step "mise trust" mise trust --quiet "$root/.mise.toml"
  step "mise install" mise install
  eval "$(mise env --shell bash)"
  echo "ok   outils de .mise.toml installés"

  # 3. Dépendances. NODE_ENV retiré : avec NODE_ENV=production, pnpm sauterait
  # les devDependencies.
  step "pnpm install" env -u NODE_ENV pnpm install --frozen-lockfile --prefer-offline
  echo "ok   dépendances installées"

  # 4. Client Prisma, depuis apps/server (prisma est une dépendance du serveur,
  # et prisma.config.ts y désigne le schéma).
  step "prisma generate" env -u NODE_ENV pnpm --dir apps/server exec prisma generate
  echo "ok   client Prisma généré"

  # 5. Modules Go du Runner.
  step "go mod download" bash -c 'cd apps/runner && go mod download'
  echo "ok   modules Go téléchargés"

  # 6. Le PostgreSQL partagé par tous les worktrees.
  postgres
}

# Le PostgreSQL partagé : celui du projet compose du dépôt principal (le nom
# que compose tire de son dossier, celui de `pnpm db:up` lancé là), donc le
# même conteneur et le même volume pour tous les worktrees. Le fichier compose
# est celui du worktree : le dépôt principal peut être en retard sur develop.
# DB_PORT passé explicitement : le port publié est celui que ce script vérifie,
# lu dans le .env du worktree (copié de celui du dépôt principal).
project=${COMPOSE_PROJECT_NAME:-$(basename "$main" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]//g')}
compose() {
  DB_PORT=$(db_port) docker compose -p "$project" -f "$root/docker-compose.yml" "$@"
}

# Le port de l'hôte : DB_PORT de .env, 5432 par défaut (docker-compose.yml).
db_port() {
  local port=
  if [[ -f $root/.env ]]; then
    port=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}DB_PORT[[:space:]]*=[[:space:]]*//p' "$root/.env" | tail -n 1)
    port=${port%$'\r'}
    port=${port//[\"\']/}
  fi
  echo "${port:-5432}"
}

# host_answers <port> <essais> : PostgreSQL répond-il sur le port de l'hôte ?
# pg_isready quand il est installé, sinon une simple connexion TCP.
host_answers() {
  local port=$1 attempt
  for ((attempt = 1; attempt <= $2; attempt++)); do
    ((attempt == 1)) || sleep 1
    if command -v pg_isready >/dev/null; then
      pg_isready -h localhost -p "$port" -t 3 >/dev/null 2>&1 && return 0
    else
      (exec 3<>"/dev/tcp/localhost/$port") 2>/dev/null && return 0
    fi
  done
  return 1
}

postgres() {
  local port running
  port=$(db_port)
  running=$(compose ps --status running -q db 2>&1) || {
    echo "$running" >&2
    fail "docker compose ne répond pas (Docker est-il lancé ?)"
  }

  if [[ -z $running ]]; then
    echo "...  conteneur db absent, démarrage"
    step "docker compose up -d --wait db" compose up -d --wait db
  elif ! compose exec -T db pg_isready -U crewdeck >/dev/null 2>&1; then
    echo "...  PostgreSQL démarre dans le conteneur db, attente"
    step "docker compose up -d --wait db" compose up -d --wait db
  fi

  if ! host_answers "$port" 1; then
    # Le conteneur tourne mais le port de l'hôte ne répond pas : le renvoi de
    # port de WSL coupé (vu après une mise en veille), que seul un redémarrage
    # du conteneur répare. Une seule fois.
    echo "...  le port $port de l'hôte ne répond pas, redémarrage du conteneur db"
    step "docker compose restart db" compose restart db
    step "docker compose up -d --wait db" compose up -d --wait db
    host_answers "$port" 3 ||
      fail "PostgreSQL ne répond pas sur le port $port, même après un redémarrage du conteneur db (docker compose -p $project logs db)"
  fi
  echo "ok   PostgreSQL répond sur le port $port"
}

drop() {
  # Le démon Nx du worktree survit à la session : arrêté ici, sinon il plante
  # pendant `git worktree remove` et réécrit .nx/workspace-data.
  env -u NODE_ENV pnpm exec nx daemon --stop >/dev/null 2>&1 || true
  echo "ok   démon Nx arrêté"

  step "suppression des sorties" rm -rf dist .nx/cache test-results playwright-report
  echo "ok   dist/, .nx/cache, test-results/ et playwright-report/ supprimés"

  drop_databases

  echo "Pour retirer le worktree, depuis le dépôt principal :"
  echo "  git -C $(printf '%q' "$main") worktree remove $(printf '%q' "$root")"
}

# Le slug du worktree dans le nom des bases d'intégration, comme `databaseName`
# de apps/server/test/integration/database.ts : le nom du dossier en
# minuscules, chaque caractère hors [a-z0-9] en « _ », coupé à 42 caractères
# (63, la limite de PostgreSQL, moins « crewdeck_it_ », « _ » et 8 hex).
slug() {
  local slug
  slug=$(basename "$root" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g')
  echo "${slug:0:42}"
}

# Les bases `crewdeck_it_<slug>_<8 hex>` de ce worktree, laissées par une
# exécution des tests d'intégration interrompue. Celles des autres worktrees
# ne sont jamais touchées.
drop_databases() {
  local running prefix list name
  local -a names
  running=$(compose ps --status running -q db 2>/dev/null) || running=
  if [[ -z $running ]]; then
    echo "ok   conteneur db arrêté : aucune base d'intégration à supprimer"
    return
  fi

  prefix="crewdeck_it_$(slug)_"
  list=$(compose exec -T db psql -U crewdeck -d crewdeck -Atc \
    "SELECT datname FROM pg_database WHERE datname LIKE 'crewdeck\_it\_%'" </dev/null 2>&1) || {
    echo "$list" >&2
    fail "liste des bases d'intégration"
  }
  mapfile -t names <<<"$list"
  for name in "${names[@]}"; do
    [[ $name == "$prefix"* && ${name#"$prefix"} =~ ^[0-9a-f]{8}$ ]] || continue
    step "suppression de la base $name" compose exec -T db psql -U crewdeck -d crewdeck \
      -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" </dev/null
    echo "ok   base $name supprimée"
  done
}

case $cmd in
  setup) setup ;;
  drop) drop ;;
esac
