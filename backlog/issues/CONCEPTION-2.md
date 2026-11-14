---
id: CONCEPTION-2
title: "A Conception's page: the Étapes its Projet's Process gives it, its documents, its Session"
epic: CONCEPTION
type: feature
priority: P1
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-1, UI-6, ATOI-2]
adr: [0003, 0005, 0006, 0008, 0011]
risques: [IA-6]
stories: [US-10, US-48]
screens: [conception, conception-contrat-incomplet]
revue_visuelle: true
video: false
reprend: 89
---

## Context

US-10, as amended by the refonte (PRD #169): the Pilote follows each Conception from the Idée to its Tickets **through the Étapes its Projet's Process gives it** (PRD, mockups, technical design in the default Modèle), so that they know where each one stands. No Étape is « désactivée pour ce Projet » any more (US-83 removed): an Étape the Process does not have is simply not on the page. US-48: an Étape whose output misses its Contrat says so, with « Relancer l'Étape ». This is the page `/conceptions/:id` every review and Décision of a Conception leads back to; it reads the Conception's pinned version (ADR 0011), so a Process changed meanwhile never reshapes a Conception in progress.

## Current state of the code

- No Conception page on develop; `apps/web/src/views/` has `a-toi.ts`, `runner.ts`, `demarrage.ts`, `composants.ts`.
- Created by CONCEPTION-1: `Design` (`apps/server/src/designs/`), `zDesign` with its `steps` (`designSteps`, `designProgress`), the store's `designs` slice, `/conceptions`, the state words `t('design.stepState.*')`.
- Created by ATOI-2: `POST /api/step-runs/:id/rerun`, the `contract-incomplete` and `step-failed` Décisions, the failed rules' labels from the Contrat declarations (`packages/contracts/src/contrats/`).
- Created by PROCESS-4: StepRuns with `iteration` and `outputs` (`{ portId, type, id, sha? }`). By PROCESS-6: Retours, the `loop-back.exhausted` Décision.
- Created by UI-6: `ProcessTrack` (`state="done|current|todo|halt"`, plus `caution` as the mockup shows), `CheckRow`; by UI-2: `Banner`, `Card`, `KeyValue`, `ListRow`, `StatusBadge`. By UI-9: ProcessTrack `stopped`.
- Created by RUNNER-9 / SESSION-2: `AgentSession` and the Session panel `?session=<id>`.
- Created by CONCEPTION-3 (when merged first): `design_documents` (each document's change number, branch, head and approved SHAs, figures); until then the « Documents » card lists the Étapes' types only.

## To do

- `apps/web/src/views/conception.ts`: pure `conceptionView(store, plaintext, designId)` → the data of `PageConception`:
  - header: the title (`Design.title`, else the Idée's), the Projet, back « Conceptions »; the primary action of a waiting gate, by the Type d'artefact of its Entrée: « Relire le PRD », « Relire la conception technique » (→ `/conceptions/:id/relecture/:stepId`), « Relire les maquettes » (→ `/conceptions/:id/maquettes/:stepId`), « Valider les Tickets » (→ `/conceptions/:id/tickets/:stepId`); « Relancer l'Étape » when an Étape is `incomplete` or `failed`; none while one runs;
  - « Avancement »: a `ProcessTrack` of « Idée retenue » (date · « <the Idée's quoted text> ») then **every Étape of the pinned Phase**, in order (row, col), by its name in the definition, with its state and meta: `done` « <date> » (« approuvé le <date> » for a gate, « PR #n » or « changement #n » for a document's Étape), `current` « depuis 14:20 » (and « passage 2 » when `iteration` > 1, « à relire » for a waiting gate, the figures of its report such as « 2 questions ouvertes »), `todo` « à venir », `caution` « Contrat incomplet », `halt` « Étape échouée »;
  - « Documents »: one row per Étape of the Phase that writes an Artefact (agent family, not judging), by its Sortie's Type d'artefact (PRD, Maquettes, Conception technique, Tickets), each « À relire », « En cours », « Approuvé » or « À venir », with « PR #n » on GitHub or « changement #n · <branch> » on Local;
  - « Session »: the `AgentRow` of the latest agent StepRun's Session (« <Étape> · <title> », its state, Moteur, time) with « Ouvrir la session » (`?session=<id>`); title and state only while the Runner is « hors ligne » (US-60);
  - « Détails »: Projet, Idée (link `/idees/:id`), « Démarrée <date> · par toi », « Process v<n> » (link `/projets/:id/process`), the Rôle of the current agent Étape with its Moteur from the effective Paramètres.
- The incomplete state (`conception-contrat-incomplet`): a `caution` `Banner` « <Étape> ne remplit pas son Contrat » listing the failed rules' labels of the Étape's last verdict, « Relance l'Étape pour que l'agent les complète, ou ouvre sa session pour lui répondre. » with « Ouvrir la session »; « Relancer l'Étape » calls ATOI-2's rerun with the StepRun's id and `seq`, the Étape goes back to `running`. The failed state shows a `halt` banner « L'Étape a échoué » with the same actions. An abandoned Conception (« Arrêter » of PROCESS-6) shows a `halt` banner « Conception arrêtée le <date> » and the track `stopped`.
- Composant `PageConception` (`packages/contracts/src/composants/page-conception.ts`, `packages/skin-passerelle/src/page-conception.ts`, in `COMPOSANTS`) with `examples` (in progress, incomplete, failed, abandoned, all done, a Phase without Maquettes), actions `review { stepId }`, `rerun { stepRunId }`, `open-session { sessionId }`, slot `aside` (CONCEPTION-10 puts « Tickets proposés » in it).
- The router maps `/conceptions/:id`; a Conception of another Pilote or unknown shows the product's « introuvable » page.
- Every « Conception à relire », « Contrat incomplet » and « Étape échouée » Décision of a Conception opens this page (or the review page of its waiting gate).
- Copy under `t('conception.*')`.
- Tests and scenarios: `apps/server/src/testing/scenarios/conception.ts` (`conception`: « Approbation du PRD » waiting after « Revue croisée du PRD » passed; `conception-contrat-incomplet`: « Découpage en Tickets » incomplete on a Process without Revue croisée), `apps/web/e2e/conception.spec.ts`.

## Decisions already made

- Mockup: `conception`, `conception-contrat-incomplet` (pages `design/screens/crewdeck/conception.html`, `…/conception-contrat-incomplet.html`; captures `design/screens/crewdeck/conception-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. Its « désactivée pour ce Projet » rows and « Désactivée » documents are not built (US-83 removed). The card « Tickets proposés » of the incomplete state is CONCEPTION-10's; the banner here lists the failed rules' labels.
- The track shows the gates and the Revues croisées as Étapes of their own, because the Process has them as Étapes: the Pilote sees exactly what their Process runs.
- The review page a gate leads to is chosen by the Type d'artefact of its Entrée, never by its name or its id: a Pilote's own « Validation finale » gate on a PRD opens the PRD's review.
- The page reads only the store (ADR 0008), never GitHub nor the relay: nothing here reads content.

## Acceptance criteria

- [ ] A Conception on « Process Crewdeck » with « Approbation du PRD » waiting shows the ten Étapes, « PRD » done with its PR number, « Revue croisée du PRD » done, the gate current « à relire », and « Relire le PRD » leading to `/conceptions/:id/relecture/<stepId>`.
- [ ] A Conception whose pinned version has no « Maquettes » shows no Maquettes row anywhere, and nothing « désactivée ».
- [ ] A PRD rerun after a Retour shows « passage 2 » on its row.
- [ ] A Découpage `incomplete` shows the caution banner with the failed rules' labels; « Relancer l'Étape » starts a new run (the fake Runner) and the Étape becomes « en cours ».
- [ ] A Conception stopped by « Arrêter » shows « Conception arrêtée » and its track `stopped`.
- [ ] « Ouvrir la session » opens the Session panel over the page; with the Runner « hors ligne » the Session row shows only its title and state.
- [ ] A change of an Étape (`design.upserted`) is on the open page within 2 s without reload.
- [ ] The Composant's `examples` render and its actions emit valid `cd-action` payloads; Playwright at 390 and 1280 px on both states, axe without violations.

## Verification

- `pnpm exec nx test web -- src/views/conception.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-conception.spec.ts`
- `pnpm exec nx e2e web -- conception.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh conception conception-contrat-incomplet`.

## For prod

Nothing.

## Out of scope

- The review pages: CONCEPTION-4 (PRD and technical design), CONCEPTION-6 (mockups), CONCEPTION-10 (Tickets).
- The Étapes' kind handlers, Skills and Contrats: CONCEPTION-3, CONCEPTION-5, CONCEPTION-7, CONCEPTION-8, CONCEPTION-9.
- The `loop-back.exhausted` Décision and its « Encore un passage »: PROCESS-6.

## Dependencies

- CONCEPTION-1.
- UI-6.
- ATOI-2.
