---
id: EPIC-E2E
title: "[EPIC] E2E: end-to-end encryption between the Runner and the Appareils"
labels: [epic:e2e]
---

ADR 0003: the primitives (HPKE base mode wrap, AES-256-GCM) in TypeScript and Go with shared test vectors and `docs/security/e2e.md`, the first Appareil paired with the Runner at link and the vault key, a new Appareil approved from a trusted one by QR code, and revocation with the vault key's rotation. Sessions' encryption is SESSION-1; Idées' is IDEE-1.

Milestones: M2 Runner and Projets (E2E-1, E2E-2), M3 Sessions and preparing Projets (E2E-3, E2E-4). Story US-60. Risks SEC-3, SEC-4, OPS-1.
