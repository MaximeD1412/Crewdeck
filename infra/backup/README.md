# Sauvegardes

Seule la base de la production est sauvegardée : le staging est jetable
([ADR 0009](../../docs/adr/0009-infra-and-delivery.md), « Backups » ; risque
OPS-2). Chaque nuit, restic l'envoie chez un autre fournisseur qu'OVH. Le mot
de passe du dépôt et ses clés sont sur le VPS et dans le gestionnaire de
mots de passe du fondateur, jamais dans GitHub : perdre le VPS ne fait pas
perdre les sauvegardes.

## Ce qui est sauvegardé

Un dump logique de la base `crewdeck` de la production, `pg_dump -Fc` dans
le service `db` du projet Compose `crewdeck-prod`. C'est un dump, pas le
volume : il se restaure sur n'importe quelle PostgreSQL 18. restic lance
lui-même le dump (`--stdin-from-command`) : un dump qui échoue ne laisse
aucun instantané, jamais un dump tronqué.

Chaque instantané est taggué `prod` et contient un seul fichier,
`/crewdeck-prod.dump`.

## Quand, et combien de temps

| Quoi | Quand |
|---|---|
| La sauvegarde (`crewdeck-backup.timer`) | chaque nuit à 01:30 UTC, à 10 minutes près ; une nuit manquée VPS éteint est rattrapée au démarrage |
| La rétention | 7 sauvegardes quotidiennes, 4 hebdomadaires, 6 mensuelles ; le reste est supprimé (`forget --prune`) après chaque sauvegarde |
| La surveillance de son âge (`.github/workflows/backup-watch.yml`) | chaque jour à 07:00 UTC, depuis GitHub |
| La répétition des migrations | à chaque déploiement de la production, avant de migrer |
| La vérification de restauration | chaque mois, depuis la machine du fondateur |

## Les fichiers

| Fichier | Rôle |
|---|---|
| `bin/backup.sh` | la sauvegarde, en root par `crewdeck-backup.service` ; écrit l'instant de sa réussite dans `/opt/crewdeck/backup/status/last-success` |
| `bin/rehearse.sh <sha>` | la répétition de la migration, installée en `/opt/crewdeck/deploy/bin/rehearse.sh`, lancée par `deploy.sh` en `deploy` |
| `bin/restore-check.sh --env <fichier>` | la vérification mensuelle, depuis la machine du fondateur |
| `bin/install.sh` | l'installation sur le VPS, en root, idempotente |
| `systemd/crewdeck-backup.{service,timer}` | l'unité oneshot et son déclencheur |
| `restic.env.example` | le modèle de `/opt/crewdeck/backup/restic.env` |

Sur le VPS :

| Chemin | Contenu |
|---|---|
| `/opt/crewdeck/backup/restic.env` | `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` ; mode 600, propriétaire `deploy` (la répétition tourne en `deploy`) |
| `/opt/crewdeck/backup/restic.password` | le mot de passe du dépôt ; mode 600, propriétaire `deploy` |
| `/opt/crewdeck/backup/bin/backup.sh` | posé par `install.sh` |
| `/opt/crewdeck/backup/status/last-success` | l'instant de la dernière sauvegarde réussie, ISO 8601 en UTC ; le dossier est monté en lecture seule dans le serveur de la production (`/run/backup`) |
| `/opt/crewdeck/deploy/bin/rehearse.sh` | posé par `install.sh` |

## L'âge de la dernière sauvegarde

Le VPS n'envoie aucun mail. L'âge de la sauvegarde est public, sans secret,
dans `GET /api/health` de la production :

```json
{ "status": "ok", "commit": "…", "db": "ok", "backup": { "lastSuccessAt": "2026-11-10T01:41:07Z" } }
```

`lastSuccessAt` est `null` tant qu'aucune sauvegarde n'a réussi ; le staging
n'a pas de clé `backup` (`BACKUP_STATUS_FILE` n'est posé que dans
`/opt/crewdeck/prod/.env`, voir `infra/deploy/prod.env.example`).

Le workflow `backup-watch` lit cette réponse chaque matin et échoue quand
`lastSuccessAt` est `null` ou date de plus de 26 h : GitHub envoie alors un
mail au fondateur. Tant que la variable de dépôt `CREWDECK_DOMAIN` est vide,
il passe avec un avis, sans rien vérifier. Le relancer à la main :
« Actions > Backup watch > Run workflow ».

Une sauvegarde échouée laisse `last-success` tel quel, et l'unité est en
échec :

```bash
systemctl status crewdeck-backup.service
journalctl -u crewdeck-backup.service --since yesterday
sudo systemctl start crewdeck-backup.service   # la relancer
```

## La répétition des migrations

En production, `deploy.sh` lance `rehearse.sh <sha>` avant de migrer : la
dernière sauvegarde est restaurée dans une PostgreSQL 18 jetable, sur un
réseau jetable, et l'image `<sha>` y lance `migrate`. Le conteneur et le
réseau sont supprimés quoi qu'il arrive. Si la restauration ou la migration
échoue (« la migration échoue sur la dernière sauvegarde »), le déploiement
s'arrête, la production n'a pas bougé. Sans aucune sauvegarde, la répétition
est sautée (« aucune sauvegarde : répétition sautée »).

## L'installation sur le VPS

Une fois, quand le dépôt restic existe (INFRA-13), puis après chaque
changement de `infra/backup/` :

1. restic ≥ 0.17 (`--stdin-from-command`) : Ubuntu 24.04 n'a que la 0.16.
   Le binaire officiel, depuis <https://github.com/restic/restic/releases>
   (`restic_<version>_linux_amd64.bz2`, vérifié contre `SHA256SUMS`), dans
   `/usr/local/bin/restic`, mode 755 ;
2. `/opt/crewdeck/backup/restic.env` depuis `restic.env.example`, et le
   fichier du mot de passe (INFRA-13) ;
3. depuis un clone du dépôt : `sudo infra/backup/bin/install.sh` ; il refuse
   sans root, sans restic ≥ 0.17, sans l'utilisateur `deploy`
   (`infra/deploy/bin/install-access.sh`) ou sans `restic.env` ;
4. `sudo systemctl start crewdeck-backup.service`, puis
   `cat /opt/crewdeck/backup/status/last-success` ;
5. `BACKUP_STATUS_DIR` et `BACKUP_STATUS_FILE` dans `/opt/crewdeck/prod/.env`
   (`infra/deploy/prod.env.example`) : le déploiement suivant de la
   production les prend.

## La vérification mensuelle, depuis la machine du fondateur

Jamais depuis le VPS : elle prouve que les sauvegardes se lisent sans lui.
Il faut restic ≥ 0.17, Docker et GNU `date`.

1. Depuis le gestionnaire de mots de passe (entrée « Crewdeck backups »),
   un fichier d'env local, hors du dépôt, et le fichier du mot de passe :

   ```bash
   RESTIC_REPOSITORY=s3:<endpoint>/<bucket>
   RESTIC_PASSWORD_FILE=/chemin/local/crewdeck-restic.password
   AWS_ACCESS_KEY_ID=…
   AWS_SECRET_ACCESS_KEY=…
   ```

2. `infra/backup/bin/restore-check.sh --env <ce fichier>` : il restaure le
   dernier instantané `prod` dans une PostgreSQL 18 locale jetable, lance
   `SELECT count(*) FROM _prisma_migrations`, et imprime la date de
   l'instantané et le nombre de migrations. Il échoue si l'instantané a plus
   de 26 h ou si la restauration échoue.
3. Effacer le fichier d'env et le fichier du mot de passe.

## Restaurer après la perte du VPS

1. Un nouveau VPS provisionné (`infra/provision/`), l'accès de déploiement et
   les `.env` posés (`infra/deploy/README.md`), restic ≥ 0.17 installé,
   `restic.env` et le mot de passe recopiés depuis le gestionnaire.
2. La production déployée une fois sur son dernier sha (relancer le job
   `production` du workflow `delivery`) : sa base est vide, migrée.
3. Arrêter le serveur, garder la base :

   ```bash
   cd /opt/crewdeck/deploy
   docker compose -p crewdeck-prod --env-file /opt/crewdeck/prod/.env -f docker-compose.yml stop server
   ```

4. Remplacer la base par la dernière sauvegarde :

   ```bash
   sudo -u deploy bash -c 'set -a; . /opt/crewdeck/backup/restic.env; set +a
     restic snapshots --tag prod
     restic dump --tag prod latest /crewdeck-prod.dump' |
     docker compose -p crewdeck-prod exec -T db \
       pg_restore -U crewdeck -d crewdeck --clean --if-exists --no-owner --exit-on-error --single-transaction
   ```

   Pour un instantané plus ancien, son id à la place de `--tag prod latest`.
5. Redémarrer : `docker compose -p crewdeck-prod --env-file /opt/crewdeck/prod/.env -f docker-compose.yml up -d`,
   puis vérifier `https://<domaine>/api/health`.
6. `sudo infra/backup/bin/install.sh`, puis lancer une sauvegarde
   (`sudo systemctl start crewdeck-backup.service`).

## Tests

```bash
pnpm exec nx test backup          # backup.sh, rehearse.sh (et deploy.sh avec lui), restore-check.sh, install.sh, backup-watch.mjs
pnpm exec nx test server -- src/health/health.controller.spec.ts
shellcheck infra/backup/bin/*
actionlint .github/workflows/backup-watch.yml
```

Les scripts y tournent pour de vrai contre un `/opt/crewdeck` temporaire
(`CREWDECK_ROOT`), avec un `PATH` dont `docker` et `restic` sont des
bouchons (`src/testing/bench.ts`) : aucun conteneur, aucun dépôt, aucun
fournisseur.
