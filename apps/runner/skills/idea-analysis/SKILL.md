---
name: idea-analysis
description: Analyse une Idée du Pilote. Lit le contexte que le Runner a écrit (l'Idée, les Projets et leurs Tickets ouverts, les autres Idées ouvertes), puis écrit son rapport (titre, résumé, Projet visé, impact, effort, doublons, questions) et l'envoie au Runner, qui le vérifie contre son Contrat.
---

# Analyser une Idée

Tu qualifies une Idée pour un développeur seul qui mène plusieurs Projets.
Tu travailles dans un dossier sans code : tu ne lis que
`.crewdeck/context.json`, tu n'écris que `.crewdeck/report.json`, et tu
n'utilises aucun autre outil que `crewdeck-runner etape`.

Écris `title`, `summary`, chaque raison et `questions` en français, simple et
court : ils se lisent dans une console, sur un téléphone aussi.

## 1. Démarrer

```sh
crewdeck-runner etape start
```

## 2. Lire le contexte

`.crewdeck/context.json` :

- `idea` : l'Idée à analyser, `{ "id", "number", "text" }`. Une section
  `## Précisions` à la fin de son texte tient les réponses de son auteur aux
  questions d'avant : elles font partie de l'Idée. Ne redemande pas ce
  qu'elles répondent ; demande seulement ce qui reste flou.
- `projects` : les Projets du Pilote, `{ "id", "name", "tickets" }`, chaque
  Ticket ouvert `{ "number", "title" }`.
- `openIdeas` : les autres Idées ouvertes, `{ "id", "number", "title",
  "summary" }`, les doublons possibles.

## 3. Écrire le rapport

`.crewdeck/report.json`, un seul objet JSON :

```json
{
  "title": "au plus 80 caractères : ce que l'Idée demande",
  "summary": "au plus 400 caractères, deux ou trois phrases : le besoin, ce qui changerait pour l'utilisateur",
  "projectId": "l'id d'un Projet de projects, ou \"nouveau\"",
  "projectWhy": "pourquoi ce Projet, en quelques mots",
  "impact": 3,
  "impactWhy": "qui gagne quoi, en quelques mots",
  "effort": 2,
  "effortWhy": "ce qu'il faut faire, en quelques mots",
  "duplicates": [{ "id": "l'id d'une Idée de openIdeas", "why": "même besoin : …" }],
  "questions": ["ce qui est flou et changerait l'analyse"]
}
```

- `projectId` : l'`id` d'un Projet de `projects`, ou `nouveau` pour un Projet
  qui n'existe pas encore.
- `impact`, de 1 à 5, pour les utilisateurs du Projet visé :
  - 1 : cosmétique, personne ne remarquerait son absence ;
  - 2 : agréable pour quelques utilisateurs, ou un petit confort ;
  - 3 : un gain net dans un parcours que les utilisateurs réguliers font
    chaque semaine ;
  - 4 : supprime une vraie douleur qu'ont beaucoup d'utilisateurs, ou demandé
    par des clients payants ou des partenaires ;
  - 5 : décide si le produit marche ou rapporte (un problème bloquant, du
    revenu, la rétention, le légal).
- `effort`, de 1 à 5, pour un développeur aidé d'agents de code :
  - 1 : moins d'une heure (un texte, un réglage, un lien) ;
  - 2 : un petit Ticket (un écran ou un endpoint changé) ;
  - 3 : quelques Tickets (une fonctionnalité à travers le back end et le
    front end) ;
  - 4 : une epic (un nouveau modèle, plusieurs écrans, un service externe) ;
  - 5 : un nouveau produit, ou la refonte d'un produit existant.
- Choisis l'ancre qui convient le mieux et dis pourquoi ; 3 n'est pas une
  valeur par défaut. Un nouveau Projet vaut au moins 4 en effort.
- `duplicates` : au plus 5, seulement des Idées de `openIdeas` qui demandent
  la même chose ; ressemblante ne suffit pas. Vide quand il n'y en a pas.
  Jamais l'Idée analysée elle-même.
- `questions` : au plus 3, chacune d'au plus 300 caractères ; vide quand
  l'Idée est claire.
- Chaque raison (`projectWhy`, `impactWhy`, `effortWhy`, `why`) tient en au
  plus 400 caractères.
- N'invente pas de Projets, ni d'ids, ni de numéros : seulement ceux du
  contexte.

## 4. Envoyer le rapport

```sh
crewdeck-runner etape report --file .crewdeck/report.json
```

Le Runner vérifie le rapport contre son Contrat avant de l'envoyer. S'il le
refuse, il dit chaque règle manquée et n'envoie rien : corrige
`.crewdeck/report.json` et envoie-le à nouveau, jusqu'à « Le rapport est
envoyé. ». Puis termine ton tour.
