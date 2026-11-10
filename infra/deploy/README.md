# Déploiement sur le VPS

Crewdeck tourne sur un VPS OVH dédié, en deux projets Docker Compose,
`crewdeck-prod` et `crewdeck-staging`, chacun avec son serveur et sa
PostgreSQL 18, derrière Caddy ([ADR 0009](../../docs/adr/0009-infra-and-delivery.md),
« Hosting »). Les deux projets lancent la même image,
`ghcr.io/maximed1412/crewdeck-server:<sha>` ; seuls leur fichier d'env et,
pour le staging, ses limites de ressources diffèrent.

## L'image

`apps/server/Dockerfile`, construite depuis la racine du dépôt :

```bash
docker build --build-arg CREWDECK_COMMIT=$(git rev-parse HEAD) -t crewdeck-server:local -f apps/server/Dockerfile .
infra/deploy/test/image-smoke.sh crewdeck-server:local
```

| Chemin dans l'image | Contenu |
|---|---|
| `/app/server` | le serveur (`dist/`) et ses dépendances de production, le schéma Prisma |
| `/app/web` | le build de la page, servi à `/` (`WEB_DIST_DIR`) |
| `/app/runner/<sha>/<os>-<arch>` | `crewdeck-runner` pour linux et darwin, amd64 et arm64, chacun avec son `.sha256` (`RUNNER_DIST_DIR`) |

Deux commandes : `serve` (par défaut) et `migrate` (`prisma migrate
deploy`). Sans `--build-arg CREWDECK_COMMIT`, la construction échoue. Le
script `image-smoke.sh`, lancé aussi par le workflow `image`
([docs/ci.md](../../docs/ci.md)), vérifie les binaires et leurs sommes,
`migrate`, `serve` contre une PostgreSQL jetable, et la garde du staging.

## L'arborescence sur le VPS

Créée par le provisionnement (INFRA-7), mode 750, groupe `docker` :

| Dossier | Contenu |
|---|---|
| `/opt/crewdeck/deploy/` | ce dossier (`docker-compose.yml`, `docker-compose.staging.yml`) et les scripts du déploiement (INFRA-6) |
| `/opt/crewdeck/prod/` | `.env` de la production, depuis `prod.env.example` (mode 600) |
| `/opt/crewdeck/staging/` | `.env` du staging, depuis `staging.env.example` (mode 600) |
| `/opt/crewdeck/edge/` | `infra/edge/` (Caddy) et son `.env`, depuis `edge.env.example` |
| `/opt/crewdeck/backup/` | les sauvegardes (INFRA-8) |

Le réseau Docker `crewdeck-edge` (créé par INFRA-7) relie Caddy aux deux
serveurs, joignables sous les alias `crewdeck-prod-server` et
`crewdeck-staging-server`. Aucun port n'est publié en dehors de Caddy (80 et
443) ; chaque base n'est que sur le réseau de son projet.

## Les fichiers d'env

Un seul fichier par environnement, lu deux fois : par Compose
(`--env-file`, pour `CREWDECK_SHA`, `POSTGRES_PASSWORD` et
`CREWDECK_ENV_FILE`) et par le serveur (`env_file`, le chemin donné par
`CREWDECK_ENV_FILE`, qui est celui du fichier lui-même). Les modèles
`prod.env.example` et `staging.env.example` listent chaque clé et d'où vient
sa valeur ; INFRA-12 les remplit. Une valeur vide vaut une clé absente.

- `CREWDECK_SHA` est écrit par le déploiement (INFRA-6), jamais à la main.
- `POSTGRES_PASSWORD` est en hexadécimal (`openssl rand -hex 32`) : il entre
  tel quel dans `DATABASE_URL`.
- Le staging refuse de démarrer avec la configuration de la production :
  `PUBLIC_URL` égale à `PROD_PUBLIC_URL`, `GITHUB_APP_ID` égal à
  `PROD_GITHUB_APP_ID`, ou une `DATABASE_URL` vers `crewdeck-prod-db`
  (`apps/server/src/config/staging-guard.ts`).

## Lancer un projet à la main

Depuis `/opt/crewdeck/deploy`. Le déploiement (INFRA-6) fait la même chose
avec le sha qu'il écrit ; à la main, c'est pour un diagnostic ou un retour
arrière.

```bash
# Staging : ses limites viennent de docker-compose.staging.yml.
docker compose -p crewdeck-staging --env-file /opt/crewdeck/staging/.env \
  -f docker-compose.yml -f docker-compose.staging.yml up -d

# Production.
docker compose -p crewdeck-prod --env-file /opt/crewdeck/prod/.env \
  -f docker-compose.yml up -d

# Les migrations, avant de démarrer une nouvelle image.
docker compose -p crewdeck-staging --env-file /opt/crewdeck/staging/.env \
  -f docker-compose.yml -f docker-compose.staging.yml run --rm server migrate

# L'état, les journaux.
docker compose -p crewdeck-staging ps
docker compose -p crewdeck-staging logs -f server
```

Caddy, depuis `/opt/crewdeck/edge` (son `.env` donne `CREWDECK_DOMAIN` et
`ACME_EMAIL`) : `docker compose up -d`.

## Vérifier les fichiers sans le VPS

Les modèles laissent vides les valeurs que le déploiement et INFRA-12
écrivent ; `test/ci.env` les remplace par des valeurs factices, et
`CREWDECK_ENV_FILE` pointe sur le modèle :

```bash
CREWDECK_ENV_FILE=staging.env.example docker compose -p crewdeck-staging \
  -f infra/deploy/docker-compose.yml -f infra/deploy/docker-compose.staging.yml \
  --env-file infra/deploy/staging.env.example --env-file infra/deploy/test/ci.env config
CREWDECK_DOMAIN=crewdeck.invalid ACME_EMAIL=acme@crewdeck.invalid \
  caddy validate --config infra/edge/Caddyfile --adapter caddyfile
```
