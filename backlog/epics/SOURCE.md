---
id: EPIC-SOURCE
title: "[EPIC] SOURCE: Sources Local and GitHub, a Projet with no Connecteur, the Source winning, moving a Type d'artefact to another Source"
labels: [epic:source]
---

One Source per Type d'artefact (ADR 0012): the `ticket` and `code` groups of each Projet on Local or GitHub; a Local Projet whose documents and Tickets are Markdown files of a git folder on the Runner's machine, followed in under 2 s, its state kept by the server with every text sealed, its content read through the relay, what the work writes kept in `local.db`; the local change of code and its merge into the folder; the Source winning over the work in progress (a Ticket changed or closed at its Source); and the migration of a group to another Source as an Action sensible that never leaves two Sources.

Milestones: M3 Sessions and preparing Projets (the Local folder, its Tickets, the relay reads), M4 Boucle (local changes and merge, the Source winning), M7 Statistics and switchover (the migration). Stories US-88, US-99, US-102, US-103. Risks AGT-8, OPS-8, OPS-9, OPS-10.
