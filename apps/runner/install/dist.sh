#!/bin/sh
# Builds crewdeck-runner for every system the Pilote may run (ADR 0004) into
# <out>/<version>/<os>-<arch>, each with its .sha256, and copies install.sh
# to <out>/install.sh: the layout the server serves from RUNNER_DIST_DIR.
#
#   CREWDECK_VERSION=<version> sh install/dist.sh [<out>]   (from apps/runner)
set -eu

out=${1:-../../dist/runner}
version=${CREWDECK_VERSION:-dev}
case "$version" in
"" | *[!0-9A-Za-z._-]*)
	printf 'CREWDECK_VERSION invalide : %s\n' "$version" >&2
	exit 1
	;;
esac

dir="$out/$version"
mkdir -p "$dir"
for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64; do
	os=${target%/*}
	arch=${target#*/}
	CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath \
		-ldflags "-s -w -X main.version=$version" \
		-o "$dir/$os-$arch" ./cmd/crewdeck-runner
	(cd "$dir" && sha256sum "$os-$arch" >"$os-$arch.sha256")
done
cp install/install.sh "$out/install.sh"
