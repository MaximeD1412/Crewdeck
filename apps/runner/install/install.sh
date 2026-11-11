#!/bin/sh
# Installs the Crewdeck Runner (ADR 0004), then links it to the Pilote's
# account:
#
#   curl -fsSL https://<domain>/runner/install.sh | sh -s -- --link <code>
#
# The server renders the two values below (its address and its version)
# when it serves this file at /runner/install.sh.
set -eu

server='__CREWDECK_SERVER__'
version='__CREWDECK_VERSION__'
code=''

say() { printf '%s\n' "$*"; }
fail() {
	printf 'Installation du Runner impossible : %s\n' "$*" >&2
	exit 1
}

while [ $# -gt 0 ]; do
	case "$1" in
	--link)
		[ $# -ge 2 ] || fail "--link attend le code de liaison."
		code=$2
		shift 2
		;;
	--link=*)
		code=${1#--link=}
		shift
		;;
	--server)
		[ $# -ge 2 ] || fail "--server attend l’adresse du serveur."
		server=$2
		shift 2
		;;
	--server=*)
		server=${1#--server=}
		shift
		;;
	*)
		fail "option inconnue : $1 (utilise --link <code> et --server <url>)."
		;;
	esac
done

server=${server%/}
case "$server" in
http://* | https://*) ;;
*) fail "l’adresse du serveur « $server » n’est pas une adresse http(s)." ;;
esac
case "$version" in
__CREWDECK_*) fail "ce script n’a pas été servi par Crewdeck : copie la commande depuis la page Premiers pas." ;;
esac
command -v curl >/dev/null 2>&1 || fail "curl est introuvable : installe-le, puis relance la commande."

again() {
	say "Relance la commande depuis la page Premiers pas de Crewdeck :"
	say "  curl -fsSL $server/runner/install.sh | sh -s -- --link ${code:-<code>}"
}

# The short id of the code, before its dash: what the server knows of it.
short_id=$(printf '%s' "${code%%-*}" | tr '[:lower:]' '[:upper:]')

# A value of uname, safe inside JSON.
clean() { printf '%s' "$1" | tr -cd 'A-Za-z0-9._-' | cut -c1-64; }

system=$(uname -s)
machine=$(uname -m)
case "$system" in
Linux) os=linux ;;
Darwin) os=darwin ;;
*) os='' ;;
esac
case "$machine" in
x86_64 | amd64) arch=amd64 ;;
aarch64 | arm64) arch=arm64 ;;
*) arch='' ;;
esac

if [ -z "$os" ] || [ -z "$arch" ]; then
	if [ -n "$code" ]; then
		curl -fsS --max-time 10 -X POST -H 'Content-Type: application/json' \
			--data "{\"shortId\":\"$(clean "$short_id")\",\"reason\":\"unsupported-system\",\"os\":\"$(clean "$system")\",\"arch\":\"$(clean "$machine")\"}" \
			"$server/api/runner/link-failures" >/dev/null 2>&1 || true
	fi
	again
	fail "ce système ($system $machine) n’est pas pris en charge : le Runner tourne sur Linux, macOS ou Windows (WSL), en amd64 ou arm64."
fi

label=$os
if [ "$os" = linux ] && grep -qi microsoft /proc/version 2>/dev/null; then
	label='Windows (WSL)'
fi

sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d ' ' -f 1
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | cut -d ' ' -f 1
	else
		fail "ni sha256sum ni shasum ne sont installés : impossible de vérifier le Runner."
	fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

say "Téléchargement du Runner $version pour $label ($arch)…"
url="$server/runner/$version/$os-$arch"
curl -fsSL --retry 2 -o "$tmp/crewdeck-runner" "$url" || {
	again
	fail "le téléchargement de $url a échoué."
}
curl -fsSL --retry 2 -o "$tmp/crewdeck-runner.sha256" "$url.sha256" || {
	again
	fail "le téléchargement de $url.sha256 a échoué."
}
expected=$(cut -d ' ' -f 1 <"$tmp/crewdeck-runner.sha256")
actual=$(sha256 "$tmp/crewdeck-runner")
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
	fail "l’empreinte SHA-256 du Runner téléchargé ne correspond pas : rien n’a été installé."
fi

bin_dir="$HOME/.local/bin"
mkdir -p "$bin_dir"
chmod 755 "$tmp/crewdeck-runner"
mv -f "$tmp/crewdeck-runner" "$bin_dir/crewdeck-runner"
say "Runner installé dans $bin_dir/crewdeck-runner."
case ":${PATH:-}:" in
*":$bin_dir:"*) ;;
*) say "Ajoute $bin_dir à ton PATH pour lancer crewdeck-runner depuis ton terminal." ;;
esac

if [ -z "$code" ]; then
	say "Relie-le à ton compte avec : $bin_dir/crewdeck-runner link <code> --server $server"
	exit 0
fi
rm -rf "$tmp"
trap - EXIT INT TERM
exec "$bin_dir/crewdeck-runner" link "$code" --server "$server"
