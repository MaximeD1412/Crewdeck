---
id: CONCEPTION-2
title: "A Conception's page: its Étapes from the Idée to the Tickets, its documents, its Session"
epic: CONCEPTION
type: feature
priority: P1
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-1, UI-6, ATOI-2]
adr: [0003, 0005, 0006, 0008]
risques: [IA-6]
stories: [US-10, US-48]
screens: [conception, conception-contrat-incomplet]
revue_visuelle: true
video: false
---

## Context

US-10: the Pilote follows each Conception from the Idée to its Tickets (PRD, mockups, technical design), an Étape optionnelle turned off for its Projet shown as such. US-48: an Étape whose output misses its Contrat says so, with « Relancer l'Étape ». This is the page `/conceptions/:id` every review and Décision of a Conception leads back to.

## Current state of the code

- Created by CONCEPTION-1: `Design`, `DesignStep` (`apps/server/src/designs/`), `stepStates(...)`, the store's `designs` slice, `/conceptions`, the Étapes' labels `t('design.steps.*')`.
- Created by ATOI-2: `POST /api/step-runs/:id/rerun`, the `contract-incomplete` and `step-failed` Décisions, the failed rules' labels from the Contrat declarations (`packages/contracts/src/contrats/`).
- Created by UI-6: `ProcessTrack` (`state="done|current|todo|off|halt"`, plus `caution` as the mockup shows), `CheckRow`; by UI-2: `Banner`, `Card`, `KeyValue`, `ListRow`, `StatusBadge`.
- Created by RUNNER-9: `AgentSession` and the Session panel route `?session=<id>` (SESSION-2).
- No Conception page.

## To do

- `apps/web/src/views/conception.ts`: pure `conceptionView(store, plaintext, designId)` → the data of `PageConception`:
  - header: the title (`Design.title`, else the Idée's), the Projet, back « Conceptions »; the primary action of the current Étape: « Relire le PRD » / « Relire les maquettes » / « Relire la conception technique » / « Relire les Tickets » when `ready` (→ `/conceptions/:id/relecture/prd`, `/conceptions/:id/maquettes`, `/conceptions/:id/relecture/technical-design`, `/conceptions/:id/tickets`), « Relancer l'Étape » when `incomplete` or `failed`, none while `running`;
  - « Avancement »: a `ProcessTrack` of « Idée retenue » (date · « <the Idée's quoted text> ») then the six Étapes with their state and meta: `done` « <date> · PR #n » for approved ones, `current` « depuis 14:20 · PR #14 · <figures> » for the one in progress (« revue croisée réglée par <Moteur> » once the cross review is done, « N questions ouvertes » from `figures.openQuestions`), `todo` « après ton approbation du PRD » for the next one, `off` « désactivée pour ce Projet » for an Étape optionnelle turned off, `caution` « Contrat incomplet » or `halt` « Étape échouée »;
  - « Documents »: PRD (`prdPath`), Maquettes (`design/screens/<slug>/`), Conception technique (`docs/adr/`), each with « À relire », « En cours », « Approuvé », « À venir » or « Désactivée »;
  - « Session »: the `AgentRow` of the latest Étape's Session (« Concevoir · <title> » or « Découper · <title> », its state, Moteur, time) with « Ouvrir la session » (`?session=<id>`); title and state only while the Runner is « hors ligne » (US-60);
  - « Détails »: Projet, Idée (link `/idees/:id`), « Démarrée <date> · par toi », « Rôle Conception » with its Moteur from the effective Paramètres.
- The incomplete state (`conception-contrat-incomplet`): a `caution` `Banner` « <Étape> ne remplit pas son Contrat » listing the failed rules' labels of the Étape's last verdict, « Relance l'Étape pour que l'agent les complète, ou ouvre sa session pour lui répondre. » with « Ouvrir la session »; « Relancer l'Étape » calls ATOI-2's rerun with the `StepRun`'s id and `seq`, the Étape goes back to `running`. The failed state (`step-failed`) shows a `halt` banner « L'Étape a échoué » with the same actions.
- Composant `PageConception` (`packages/contracts/src/composants/page-conception.ts`, `packages/skin-passerelle/src/page-conception.ts`) with `examples` (in progress, incomplete, failed, all done), actions `review { step }`, `rerun { stepRunId }`, `open-session { sessionId }`, slot `aside` (CONCEPTION-10 puts « Tickets proposés » in it).
- The router maps `/conceptions/:id`; a Conception of another Pilote or unknown shows the product's « introuvable » page.
- Every « Conception à relire », « Contrat incomplet » and « Étape échouée » Décision of a Conception opens this page (or its review page when `ready`).
- Copy under `t('conception.*')`.
- Tests and scenarios: `apps/server/src/testing/scenarios/conception.ts` (`conception`: PRD à relire with cross review done; `conception-contrat-incomplet`: Découpage incomplete with the cross review off), `apps/web/e2e/conception.spec.ts`.

## Decisions already made

- Mockup: `conception`, `conception-contrat-incomplet` (pages `design/screens/crewdeck/conception.html`, `…/conception-contrat-incomplet.html`; captures `design/screens/crewdeck/conception-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The card « Tickets proposés » of the incomplete state is CONCEPTION-10's (it reads the backlog files from the PR); the banner here lists the failed rules' labels, not the Tickets' names.
- The page reads only the store: no fetch of its own (ADR 0008); nothing here reads GitHub content.
- An Étape optionnelle turned off shows `off` until reached, then `skipped` (« sans objet ») once the Conception went past it.

## Acceptance criteria

- [ ] A Conception with its PRD `ready` shows « PRD à relire » current with its PR number and the cross review's state, « Relire le PRD » leading to `/conceptions/:id/relecture/prd`.
- [ ] The cross review turned off for the Projet shows « Revue croisée · désactivée pour ce Projet » in the track.
- [ ] A Découpage `incomplete` shows the caution banner with the failed rules' labels; « Relancer l'Étape » starts a new run (the fake Runner) and the Étape becomes « en cours ».
- [ ] « Ouvrir la session » opens the Session panel over the page; with the Runner « hors ligne » the Session row shows only its title and state.
- [ ] A change of an Étape (event `design.upserted`) is on the open page within 2 s without reload.
- [ ] The Composant's `examples` render and its actions emit valid `cd-action` payloads; Playwright at 390 and 1280 px on both states, axe without violations.

## Verification

- `pnpm exec nx test web -- src/views/conception.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-conception.spec.ts`
- `pnpm exec nx e2e web -- conception.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh` for `conception`, `conception-contrat-incomplet`.

## For prod

Nothing.

## Out of scope

- The review pages: CONCEPTION-4 (PRD and technical design), CONCEPTION-6 (mockups), CONCEPTION-10 (Tickets).
- The Étapes' Skills and Contrats: CONCEPTION-3, CONCEPTION-5, CONCEPTION-7, CONCEPTION-8, CONCEPTION-9.

## Dependencies

- CONCEPTION-1.
- UI-6.
- ATOI-2.
