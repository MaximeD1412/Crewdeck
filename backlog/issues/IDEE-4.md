---
id: IDEE-4
title: "Dictation of an Idée or of a message to an agent (Web Speech API)"
epic: IDEE
type: feature
priority: P2
size: S
milestone: M5 Idées
blocked_by: [IDEE-1, SESSION-2]
adr: [0007]
risques: [SEC-9]
stories: [US-57]
screens: [idees-dictee]
revue_visuelle: true
video: false
---

## Context

US-57: the Pilote dictates an Idée or a message to an agent, on the PC or the phone, the transcript filling the field so that they correct it before sending. ADR 0007 settles the browser's Web Speech API, the button hidden where the API is missing (keyboard dictation still works). Risk SEC-9: the browser may send the audio to its vendor's service (Google, Apple); the help of the dictation says so.

## Current state of the code

- Created by IDEE-1: the « Noter une Idée » dialog (`NoteIdeaDialog`, `packages/skin-passerelle/src/note-idea-dialog.ts`), `notedFrom`, `dictated` on `Idea` (always false so far).
- Created by SESSION-2: the Session panel and its `Composer` (UI-7's `Composer/Default`, `Composer/Dictating`, `state="dictating|disabled"`).
- No dictation code.

## To do

- `apps/web/src/dictation/dictation.ts`: the core's dictation service, outside the Skin (a Skin never touches the microphone): `isDictationAvailable()` (`window.SpeechRecognition ?? window.webkitSpeechRecognition`), `startDictation({ lang: 'fr-FR', onTranscript(text, final), onEnd(reason) }) → { stop() }` with `interimResults: true`, `continuous: true`; ends on `stop()`, on the API's `end`, after 60 s, or on an error (`not-allowed` → « Micro refusé : autorise-le dans ton navigateur. », `no-speech` → « Je n'ai rien entendu. », other → « La dictée s'est arrêtée. »).
- The Composants get the dictation through data and actions only:
  - `NoteIdeaDialog` data gains `dictation: { available: boolean, state: 'idle' | 'dictating', elapsedSeconds, error: string | null }`, actions `dictate-start`, `dictate-stop`; the text field's value follows the transcript, interim text included, and stays editable once stopped.
  - `Composer` (Session panel) gets the same `dictation` data and actions; its `Dictating` variant shows « Dictée en cours · 0:07 ».
  - Hidden button when `available` is false; no message.
- The help line under the field while dictating: « Transcription en direct : tu pourras la corriger avant de noter. »; the first time on an Appareil, a one-line notice above it: « La dictée passe par le service de reconnaissance de ton navigateur (Google pour Chrome, Apple pour Safari). » (kept dismissed in `localStorage` key `crewdeck.dictation.notice`).
- An Idée noted after a dictation (the text came at least partly from it) is sent with `dictated: true` (IDEE-1's « au téléphone, dictée »).
- The transcript never leaves the browser except as the sealed Idée or the encrypted Session message the Pilote sends.
- Copy under `t('dictation.*')`.
- Tests: a fake `SpeechRecognition` in `apps/web/src/dictation/fake-speech.ts` injected by Playwright (`page.addInitScript`) for `apps/web/e2e/idees-dictee.spec.ts`; a scenario `apps/server/src/testing/scenarios/idees-dictee.ts` (the list of `idees` with the dialog open).

## Decisions already made

- Mockup: `idees-dictee` (page `design/screens/crewdeck/idees-dictee.html`; captures `design/screens/crewdeck/idees-dictee-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Web Speech only (ADR 0007); no Whisper on the Runner, no audio recorded or uploaded by Crewdeck.
- Stop is a secondary button with the `stop` icon, « Arrêter la dictée » (DESIGN.md's interactive states); the status dot is `halt` and pulses while dictating.
- Language `fr-FR` at the MVP (UI in French).

## Acceptance criteria

- [ ] With the fake recognition, « Dicter » fills the field with the interim then final transcript and shows « Dictée en cours · 0:0n »; « Arrêter la dictée » stops it and the field stays editable.
- [ ] The Idée noted after a dictation is stored with `dictated: true`; one typed only is `false`.
- [ ] Where the API is missing, no « Dicter » button is rendered, in the Idée dialog and in the Composer.
- [ ] A `not-allowed` error shows « Micro refusé : autorise-le dans ton navigateur. » and returns to idle.
- [ ] The notice about the browser's service shows once per Appareil.
- [ ] The Composer dictation fills the message field without sending it.
- [ ] Playwright at 390 and 1280 px on `idees-dictee`, axe without violations.

## Verification

- `pnpm exec nx test web -- src/dictation/dictation.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/note-idea-dialog.spec.ts`
- `pnpm exec nx e2e web -- idees-dictee.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh` for `idees-dictee`.

## For prod

Nothing.

## Out of scope

- Other languages than French: US-28 (Bêta).
- Dictation anywhere else than the Idée field and the Composer.

## Dependencies

- IDEE-1.
- SESSION-2.
