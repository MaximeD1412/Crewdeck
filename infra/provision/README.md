# Provisionnement du VPS

`provision.sh` prépare un VPS Ubuntu 24.04 neuf pour Crewdeck
([ADR 0009](../../docs/adr/0009-infra-and-delivery.md), « Provisioning ») :
SSH par clé seule, fail2ban, pare-feu, Docker CE et sa chaîne `DOCKER-USER`,
mises à jour de sécurité, l'arborescence `/opt/crewdeck` et le réseau
`crewdeck-edge` qu'attendent les projets Compose
([infra/deploy/README.md](../deploy/README.md)).

Il est idempotent : relancé, il ne touche à rien de ce qui est déjà en place,
et le dit. Tout est vérifié avant la moindre modification ; une machine qu'il
refuse (une autre version d'Ubuntu, une configuration qui annulerait le
durcissement) reste telle quelle.

## Prérequis

- Ubuntu 24.04 LTS, amd64 ou arm64. Toute autre version est refusée tout de
  suite : « Ubuntu 24.04 attendu ».
- Un accès root, ou un compte avec sudo (`ubuntu` sur un VPS OVH).
- La clé publique de l'administrateur sur la machine : celle que l'hébergeur
  a posée suffit (`~/.ssh/authorized_keys` du compte de connexion).

## Le lancer

Depuis la machine du fondateur, à la racine du dépôt :

```bash
scp infra/provision/provision.sh ubuntu@<ip>:
ssh ubuntu@<ip> 'sudo bash provision.sh --admin-user ops --admin-key ~/.ssh/authorized_keys'
```

Ou par l'environnement :

```bash
ssh ubuntu@<ip> 'sudo ADMIN_USER=ops ADMIN_KEY=$HOME/.ssh/authorized_keys bash provision.sh'
```

- `--admin-user` : le compte d'administration, créé s'il n'existe pas (ni
  `root`, ni `deploy`, le compte du déploiement d'INFRA-6). Un compte
  existant convient, `ubuntu` compris.
- `--admin-key` : un fichier de clés publiques (`ssh-ed25519 AAAA…`). Seules
  les lignes de clé simples sont recopiées ; une clé à options (`command=`,
  `from=`…) ne l'est jamais.

**Avant de fermer la session**, en ouvrir une autre avec le compte
d'administration : `ssh ops@<ip>`. Après le passage, SSH n'accepte plus que
`AllowUsers <admin> deploy`, par clé : `root` et tout autre compte (`ubuntu`
si ce n'est pas l'administrateur) ne peuvent plus se connecter. Un
rechargement de sshd ne coupe pas la session ouverte.

## Ce qu'il fait

Chaque étape affiche « déjà fait » ou « appliqué : <quoi> » ; la dernière
ligne dit « rien à changer » quand toutes l'étaient déjà. Les sorties des
commandes système vont sur stderr, le résumé seul sur stdout.

| Étape | Ce qui est en place après |
|---|---|
| 1. Compte d'administration | le compte, sa clé dans `~/.ssh/authorized_keys` (600), sudo sans mot de passe (`/etc/sudoers.d/90-crewdeck-<admin>`, validé par `visudo`) |
| 2. SSH | `/etc/ssh/sshd_config.d/00-crewdeck.conf` : `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `AllowUsers <admin> deploy` ; validé par `sshd -t` avant le rechargement, sinon remis comme avant |
| 3. fail2ban | la prison `sshd` (`/etc/fail2ban/jail.d/crewdeck.local`) : 5 essais, banni 1 h |
| 4. Pare-feu ufw | entrées refusées par défaut, sauf 22, 80 et 443 en TCP et 443 en UDP |
| 5. Docker | Docker CE depuis le dépôt apt de Docker, `daemon.json` avec `log-driver: local` et `live-restore`, l'administrateur dans le groupe `docker` ; la chaîne `DOCKER-USER` qui ferme tout port publié sauf 80 et 443, rechargée après chaque démarrage de Docker par `crewdeck-docker-user.service` |
| 6. Mises à jour de sécurité | unattended-upgrades, quotidiennes, des seules origines `-security`, sans redémarrage automatique |
| 7. Arborescence et réseau | `/opt/crewdeck/{deploy,prod,staging,edge,backup}`, mode 750, groupe `docker` ; le réseau `crewdeck-edge` |

Ce qu'il refuse, avant toute modification, avec le moyen d'en sortir :

- une directive sshd qui annulerait le durcissement (lue avant
  `00-crewdeck.conf`, dans un bloc `Match`, ou dans un fichier inclus hors
  de `sshd_config.d`) ;
- un sshd qui n'écoute pas sur 22, seul port SSH ouvert ;
- une règle ufw hors de 22, 80 et 443 ;
- les paquets Docker d'Ubuntu (`docker.io`, …) ;
- un Docker dont les ports publiés échapperaient à `DOCKER-USER` (backend
  nftables, `iptables: false`, réseaux routed par défaut).

## Le relancer

La même commande. Sur une machine déjà provisionnée, elle affiche « déjà
fait » pour les sept étapes puis « rien à changer », sans toucher à `/etc`
ni redémarrer un service. Après une modification à la main d'un fichier
qu'il gère (en-tête « Managed by infra/provision/provision.sh »), il le
remet et le dit.

## Les tests

`src/*.spec.ts`, Vitest, projet Nx `provision` :

```bash
pnpm exec nx test provision               # quand provision.yml tourne (sans Docker)
pnpm exec nx test-integration provision   # le script, deux fois, sur une machine jetable
```

`test-integration` construit `test/Dockerfile` (Ubuntu 24.04 avec systemd),
lance un conteneur privilégié où il installe Docker, puis passe le script
deux fois : le second passage doit dire « rien à changer » et laisser `/etc`
identique. Un espace de noms réseau `dehors`, dans la machine, joue
Internet : SSH par mot de passe et root refusés, la clé acceptée, 5432
fermé, 80 et 443 ouverts. Un conteneur Ubuntu 22.04 vérifie le refus. Il
faut Docker en local, avec les conteneurs privilégiés et cgroup v2 ; compter
deux à trois minutes. `PROVISION_KEEP=1` garde la machine pour regarder
dedans (`docker exec -it crewdeck-provision-<pid> bash`, puis `docker rm -f
-v` du conteneur).

En CI, `.github/workflows/provision.yml` lance `shellcheck` et
`test-integration` sur les PR et les pushs qui changent `infra/provision/` ;
`test` passe avec les autres projets dans `ci.yml`
([docs/ci.md](../../docs/ci.md)).
