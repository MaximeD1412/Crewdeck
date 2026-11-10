#!/usr/bin/env bash
# Les captures de la revue visuelle d'un ticket (AGENTS.md, « Delivering a
# ticket » ; ADR 0009, « Visual review ») : chaque scénario à 390 × 844 et
# 1280 × 800, pris par les tests Playwright (apps/web/e2e/captures.spec.ts),
# poussé sur la branche orpheline captures/<n>, qui ne porte que des captures,
# jamais de code, et n'est jamais fusionnée.
#
#   scripts/captures.sh [--ticket <n>] <scénario>…
#   scripts/captures.sh a-toi a-toi-vide
#
# Un scénario porte l'id de l'écran ou de l'état qu'il montre dans
# design/screens.json (`<id>` ou `<id>-<état>`) ; il est déclaré dans
# apps/server/src/testing/scenarios/. Le numéro du ticket vient de la branche
# (feat/<n>-…, fix/<n>-…, chore/<n>-…), sinon de --ticket. Les fichiers
# <scénario>-390.png et <scénario>-1280.png de la branche sont remplacés,
# ceux des autres scénarios gardés, dans un nouveau commit à chaque passage.
# Sortie : une ligne Markdown par capture, à coller dans la PR. La commande
# refuse de tourner avec NODE_ENV=production.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage : scripts/captures.sh [--ticket <n>] <scénario>…

  <scénario>    l'id d'un écran ou d'un état de design/screens.json (a-toi,
                a-toi-vide), déclaré dans apps/server/src/testing/scenarios/
  --ticket <n>  le numéro du ticket, quand la branche n'est pas
                feat/<n>-…, fix/<n>-… ou chore/<n>-…
EOF
  exit 2
}

fail() {
  echo "ÉCHEC : $*" >&2
  exit 1
}

ticket=''
scenarios=()
while (($# > 0)); do
  case $1 in
    --ticket)
      (($# >= 2)) || usage
      ticket=$2
      shift 2
      ;;
    --ticket=*)
      ticket=${1#*=}
      shift
      ;;
    -*) usage ;;
    *)
      [[ $1 =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
        echo "« $1 » n'est pas un id d'écran de design/screens.json." >&2
        usage
      }
      scenarios+=("$1")
      shift
      ;;
  esac
done
((${#scenarios[@]} > 0)) || usage

# Les scénarios vident la base : jamais contre la production, où la route de
# test n'existe d'ailleurs pas.
if [[ $(printf '%s' "${NODE_ENV:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]') == production ]]; then
  fail "NODE_ENV vaut « production » : les captures vident la base du serveur, elles ne tournent jamais en production."
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "à lancer dans le dépôt"
cd "$root"

if [[ -z $ticket ]]; then
  branch=$(git symbolic-ref --quiet --short HEAD || true)
  if [[ $branch =~ ^(feat|fix|chore)/([0-9]+)- ]]; then
    ticket=${BASH_REMATCH[2]}
  else
    fail "la branche « ${branch:-détachée} » ne donne pas de numéro de ticket (feat/<n>-…) : passer --ticket <n>."
  fi
fi
[[ $ticket =~ ^[1-9][0-9]*$ ]] || fail "numéro de ticket invalide : « $ticket »"

repo=$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(".process.json", "utf8")).repo ?? ""))') ||
  fail ".process.json illisible"
[[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "« repo » de .process.json invalide : « $repo »"

target=captures/$ticket
names=$(IFS=,; printf '%s' "${scenarios[*]}")
temporary=$(mktemp -d "${TMPDIR:-/tmp}/captures-$ticket.XXXXXX")
shots=$temporary/png
worktree=$temporary/worktree
created_branch=''
mkdir "$shots"

cleanup() {
  local code=$?
  trap - EXIT
  if [[ -d $worktree ]]; then
    git worktree remove --force "$worktree" >/dev/null 2>&1 || true
  fi
  git worktree prune >/dev/null 2>&1 || true
  if [[ -n $created_branch ]]; then
    git branch -D "$target" >/dev/null 2>&1 || true
  fi
  rm -rf "$temporary"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 1. Les captures, par les tests Playwright : leur sortie va sur stderr, la
# sortie standard ne porte que les lignes Markdown.
CAPTURES_DIR=$shots CAPTURES_SCENARIOS=$names pnpm exec nx e2e web -- captures.spec.ts >&2 ||
  fail "les captures de $names n'ont pas été prises (voir ci-dessus)"

# La largeur d'un PNG, lue dans son en-tête IHDR (octets 16 à 19, gros-boutiste).
png_width() {
  od -An -tu1 -j16 -N4 -- "$1" | awk '{ print $1 * 16777216 + $2 * 65536 + $3 * 256 + $4 }'
}

for name in "${scenarios[@]}"; do
  for width in 390 1280; do
    file=$shots/$name-$width.png
    [[ -s $file ]] || fail "$name-$width.png n'a pas été écrite : le scénario « $name » existe-t-il ?"
    actual=$(png_width "$file")
    [[ $actual == "$width" ]] || fail "$name-$width.png fait $actual px de large au lieu de $width"
  done
done

# 2. La branche captures/<n> dans un worktree temporaire : reprise d'origin
# quand elle y est, sinon créée orpheline.
remote=0
git ls-remote --exit-code --heads origin "$target" >/dev/null || remote=$?
case $remote in
  0)
    git fetch --quiet origin "+refs/heads/$target:refs/remotes/origin/$target" || fail "git fetch origin $target"
    git worktree add --quiet --detach "$worktree" "refs/remotes/origin/$target" >&2 || fail "worktree de $target"
    ;;
  2)
    # Une branche locale du même nom, laissée par un passage interrompu, ne
    # porte que des captures : elle est remplacée.
    git branch -D "$target" >/dev/null 2>&1 || true
    git worktree add --quiet --detach --no-checkout "$worktree" >&2 || fail "worktree de $target"
    created_branch=1
    git -C "$worktree" switch --quiet --orphan "$target" || fail "git switch --orphan $target"
    ;;
  *) fail "origin ne répond pas (git ls-remote, code $remote)" ;;
esac

for name in "${scenarios[@]}"; do
  for width in 390 1280; do
    cp "$shots/$name-$width.png" "$worktree/$name-$width.png"
    git -C "$worktree" add -- "$name-$width.png"
  done
done
# --allow-empty : des captures identiques au passage précédent font quand même
# leur commit, la trace de ce passage.
git -C "$worktree" commit --quiet --allow-empty -m "captures(#$ticket) : ${names//,/, }" || fail "commit des captures"
git -C "$worktree" push --quiet origin "HEAD:refs/heads/$target" >&2 || fail "git push origin $target"

# 3. Les lignes à coller dans la PR.
for name in "${scenarios[@]}"; do
  for width in 390 1280; do
    printf '![%s %s](https://github.com/%s/blob/%s/%s-%s.png?raw=true)\n' "$name" "$width" "$repo" "$target" "$name" "$width"
  done
done
