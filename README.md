# Crewdeck

Piloter ses projets avec des agents IA, de l'idée au ticket livré, en temps réel.
Une interface entièrement personnalisable : du tableau de bord sobre à l'open space isométrique.

## Développer

Prérequis : [mise](https://mise.jdx.dev) et Docker.

```bash
mise install                # Node 24, pnpm 10 et Go, aux versions de .mise.toml
pnpm install
cp .env.example .env        # changer DB_PORT et DATABASE_URL si le port 5432 est pris
pnpm db:up                  # PostgreSQL 18 dans Docker, puis les migrations
pnpm dev                    # le serveur sur :3000, la page sur http://localhost:4200
```

`http://localhost:4200/api/health` répond alors `{"status":"ok","commit":"dev","db":"ok"}`.
La documentation OpenAPI de l'API, générée depuis les contrats, est sur
`http://localhost:3000/api/docs` (`/api/docs.json`), jamais en production.

Les contrats (`packages/contracts`) sont écrits une fois en zod : après un
changement, `pnpm exec nx run contracts:generate` réécrit leur JSON Schema et
les types Go du Runner, à commiter. Les commandes de vérification sont dans
[`AGENTS.md`](AGENTS.md#checking).

Les jetons de la Skin Passerelle (`packages/skin-passerelle/src/tokens.css`,
les `--cd-*`) sont générés depuis `design/tokens.json` : après un changement
des maquettes, `pnpm exec nx run skin-passerelle:tokens`, à commiter aussi.

Les tests de bout en bout (Playwright, `apps/web/e2e/`) tournent à 390 et
1280 px contre `pnpm dev`, qu'ils lancent s'il ne tourne pas déjà ; chaque test
part d'un scénario semé par le serveur (`apps/server/src/testing/scenarios/`,
hors production seulement). Une fois : `pnpm --dir apps/web exec playwright
install chromium`. Puis `pnpm exec nx e2e web -- smoke.spec.ts`, et
`scripts/captures.sh <scénario>…` pour les captures d'une revue visuelle.
