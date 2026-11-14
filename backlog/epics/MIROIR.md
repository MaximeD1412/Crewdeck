---
id: EPIC-MIROIR
title: "[EPIC] MIROIR: the Runner's copy of every Source and of the documents, the agents' one channel"
labels: [epic:miroir]
---

The Miroir of ADR 0010: the server keeps a content-free envelope of every webhook of a followed repository and replays them to the Runner over its own protocol (`hello.mirrorAfter`, `github.changed`, `mirror.resync`), with a read-only « Miroir » token per installation; the Runner keeps `~/.crewdeck/miroir.db` (issues, PRs, comments, reviews, checks, relations, and the index of the validated documents), applies each envelope by fetching the object from GitHub itself, reconciles every 15 min, and answers the agents through `crewdeck-runner miroir` in `gh`'s shapes, with the copy's freshness; for a Local Projet too, and every write of an agent goes through it (`miroir issue|pr create|comment|review|close…`, ADR 0012). The `mirror` shim of the Sessions is RUNNER-10's, the Skills reading through it RUNNER-12's.

Milestone: M3 Sessions and preparing Projets. Stories US-15, US-20, US-60. Risks SEC-6, SEC-10, AGT-7.
