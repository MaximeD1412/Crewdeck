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
| `/opt/crewdeck/deploy/` | ce dossier (`docker-compose.yml`, `docker-compose.staging.yml`), `ghcr.env` et, dans `bin/`, les scripts du déploiement (« Livraison ») |
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

- `CREWDECK_SHA` est écrit par le déploiement (« Livraison »), jamais à la main.
- `POSTGRES_PASSWORD` est en hexadécimal (`openssl rand -hex 32`) : il entre
  tel quel dans `DATABASE_URL`.
- Le staging refuse de démarrer avec la configuration de la production :
  `PUBLIC_URL` égale à `PROD_PUBLIC_URL`, `GITHUB_APP_ID` égal à
  `PROD_GITHUB_APP_ID`, ou une `DATABASE_URL` vers `crewdeck-prod-db`
  (`apps/server/src/config/staging-guard.ts`).

## Lancer un projet à la main

Depuis `/opt/crewdeck/deploy`. Le déploiement (« Livraison ») fait la même
chose avec le sha qu'il écrit ; à la main, c'est pour un diagnostic ou un
retour arrière, jamais pour lancer un autre sha.

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

## Livraison

Le déploiement est poussé par GitHub ([ADR 0009](../../docs/adr/0009-infra-and-delivery.md),
« Delivery ») : aucun service n'écoute sur le VPS. Le workflow
[`delivery`](../../.github/workflows/delivery.yml) :

- **push sur `develop`** (job `staging`, environnement GitHub `staging`) :
  construit l'image avec `CREWDECK_COMMIT=<sha>`, la pousse en
  `ghcr.io/maximed1412/crewdeck-server:<sha>`, lance `deploy staging <sha>`
  sur le VPS, puis, si le déploiement a réussi, pose le tag `staged-<sha>` :
  la preuve que le staging a tourné sur cette image ;
- **push sur `main`** (job `production`, environnement `production`) : main
  n'avance que par le commit de merge de la PR `develop` → `main`. Le job
  échoue si `HEAD` n'est pas un merge à deux parents, si son arbre n'est pas
  celui de `HEAD^2` (« main contient autre chose que develop »,
  `ci/production-sha.sh`) ou si `staged-<HEAD^2>` n'existe pas (« cette
  image n'a pas été déployée sur le staging ») ; sinon il lance
  `deploy production <HEAD^2>`. Rien n'est reconstruit ;
- tant que la variable `DEPLOY_HOST` de l'environnement est vide, les deux
  jobs passent avec l'avis « VPS pas encore configuré », sans rien publier ni
  déployer (le job `production` vérifie quand même le merge).

Deux livraisons de la même branche se suivent, jamais annulées.

### Sur le VPS

| Fichier | Rôle |
|---|---|
| `bin/deploy-trigger <env>` | la commande forcée de la clé de `<env>` : n'accepte que `deploy <env> <sha de 40 caractères hexadécimaux>`, sinon « commande refusée », code 1 |
| `bin/deploy.sh <env> <sha>` | le déploiement, en `deploy` (groupe `docker`) |
| `bin/install-access.sh` | posé une fois en root (INFRA-12) : l'utilisateur `deploy`, les scripts dans `/opt/crewdeck/deploy/bin/`, `~deploy/.ssh/authorized_keys` |
| `ghcr.env.example` | le modèle de `/opt/crewdeck/deploy/ghcr.env`, le jeton de lecture de ghcr.io |

`deploy.sh` :

1. un seul déploiement à la fois par environnement
   (`/run/lock/crewdeck-deploy-<env>.lock`) : le second sort tout de suite
   avec « déploiement déjà en cours » ;
2. `docker login ghcr.io` avec `ghcr.env`, `docker pull` de l'image ;
3. en production seulement, la répétition de la migration sur la dernière
   sauvegarde, `/opt/crewdeck/deploy/bin/rehearse.sh <sha>` (INFRA-8) quand
   il est installé : un échec arrête tout, rien n'a bougé ;
4. `CREWDECK_SHA=<sha>` dans `/opt/crewdeck/<env>/.env`, `run --rm server
   migrate`, `up -d` ;
5. `/api/health` à `http://<projet>-server:3000`, l'adresse qu'emprunte
   Caddy, depuis le conteneur, pendant 60 s, jusqu'à `status: ok`, le commit
   `<sha>` et `db: ok` ;
6. en cas d'échec, retour au sha de `/opt/crewdeck/<env>/current-sha` sans
   rien migrer à l'envers (les migrations restent compatibles avec la version
   précédente), `up -d`, code 1 : « déploiement de `<sha>` échoué, retour à
   `<précédent>` ». En cas de succès, `current-sha` devient `<sha>`.

Le journal est dans le job GitHub et dans celui de la machine :
`journalctl -t crewdeck-deploy`.

### Redéployer

- **Relancer le déploiement** : relancer le job du workflow `delivery`
  (« Re-run jobs ») sur le commit voulu de `develop` ou de `main`. Il refait
  le même chemin, avec les mêmes vérifications.
- **Jamais** `docker compose up` avec un autre sha à la main, sauf un retour
  arrière : écrire le sha de `current-sha` (celui qui tournait) dans
  `CREWDECK_SHA` du `.env`, puis `up -d` (« Lancer un projet à la main »).
  Le déploiement suivant repart de `current-sha`.
- Après un changement de `bin/`, relancer `install-access.sh` ; après un
  changement des fichiers Compose, les recopier dans `/opt/crewdeck/deploy/`.

### Tests

```bash
pnpm exec nx test deploy          # deploy-trigger, deploy.sh, install-access.sh --print, production-sha.sh
shellcheck infra/deploy/bin/* infra/deploy/ci/*
actionlint .github/workflows/delivery.yml
```

`deploy.sh` y tourne contre un `/opt/crewdeck` temporaire (`CREWDECK_ROOT`)
et un `PATH` dont `docker` et `logger` sont des bouchons ; `flock` est celui
de la machine.
