# syntax=docker/dockerfile:1

# The server's image, one per commit (ADR 0009, « Delivery »): the server, the
# web build it serves at `/`, and the Runner binaries it serves to the
# Pilote's machine (ADR 0004, « Packaging »), all of the same commit. One image
# for production and staging: only the env file and the limits differ.
#
# From the repository's root:
#   docker build --build-arg CREWDECK_COMMIT=$(git rev-parse HEAD) -f apps/server/Dockerfile .
#
# Commands: `serve` (default) and `migrate` (apps/server/bin/entrypoint.sh).

# The versions of .mise.toml: the workflow `image` fails when they drift.
ARG NODE_VERSION=24.22.2
ARG GO_VERSION=1.27.3

# ---- build: the server, the web build, the server's production dependencies
FROM node:${NODE_VERSION}-bookworm-slim AS build
# No side-effects cache: a postinstall (Prisma's engines) runs for this
# image's system, never comes back from the store of another build.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store \
    npm_config_side_effects_cache=false \
    NX_DAEMON=false \
    NX_NO_CLOUD=true
# Prisma picks its engines by the OpenSSL it finds, here and in the image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /repo

# The store from the lockfile alone: a change of code reuses this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=crewdeck-pnpm-store,target=/pnpm/store pnpm fetch

COPY . .
RUN --mount=type=cache,id=crewdeck-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline \
 && pnpm exec nx run-many -t build -p server web --skip-nx-cache \
 && pnpm deploy --filter @crewdeck/server --prod --legacy /out

# ---- runner: crewdeck-runner for every platform the Pilote may run
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-bookworm AS runner
ARG CREWDECK_COMMIT
RUN case "$CREWDECK_COMMIT" in \
      "" | *[!0-9A-Za-z._-]*) \
        echo "CREWDECK_COMMIT manquant ou invalide : docker build --build-arg CREWDECK_COMMIT=\$(git rev-parse HEAD) …" >&2; exit 1 ;; \
    esac
WORKDIR /src
COPY apps/runner/go.mod apps/runner/go.sum ./
RUN --mount=type=cache,id=crewdeck-go-mod,target=/go/pkg/mod go mod download
COPY apps/runner/ ./
RUN --mount=type=cache,id=crewdeck-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=crewdeck-go-build,target=/root/.cache/go-build \
    CREWDECK_VERSION="$CREWDECK_COMMIT" sh install/dist.sh /runner

# ---- the image
FROM node:${NODE_VERSION}-bookworm-slim
# `migrate` runs Prisma's schema engine, which links OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
ARG CREWDECK_COMMIT
RUN case "$CREWDECK_COMMIT" in \
      "" | *[!0-9A-Za-z._-]*) \
        echo "CREWDECK_COMMIT manquant ou invalide : docker build --build-arg CREWDECK_COMMIT=\$(git rev-parse HEAD) …" >&2; exit 1 ;; \
    esac
LABEL org.opencontainers.image.revision="$CREWDECK_COMMIT" \
      org.opencontainers.image.source="https://github.com/MaximeD1412/Crewdeck" \
      org.opencontainers.image.title="crewdeck-server"
ENV NODE_ENV=production \
    PORT=3000 \
    CREWDECK_COMMIT="$CREWDECK_COMMIT" \
    WEB_DIST_DIR=/app/web \
    RUNNER_DIST_DIR=/app/runner

COPY --from=build /out /app/server
COPY --from=build /repo/apps/web/dist /app/web
COPY --from=runner /runner /app/runner

WORKDIR /app/server
USER node
EXPOSE 3000
# Only Caddy reaches the server; Compose and the deploy read this status.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/app/server/bin/entrypoint.sh"]
CMD ["serve"]
