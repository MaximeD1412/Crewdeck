# Real time: one WebSocket per client, numbered events, a snapshot on a gap

> **Status:** accepted, 2026-11-10.

## Context

A change on GitHub or from an agent must be on screen in under 2 s, p95
(US-20); after a lost connection the page says « resynchronisation… » and
disables the **Actions sensibles** until the state is sure (US-21); a
notification goes to the phone when a **Décision** waits and the Pilote is
away, « away » meaning no Crewdeck tab visible for 2 minutes (US-18). The
browser also talks to the **Runner** (a message to an agent, an answer to a
permission request), through the server, encrypted.

## Decision

- **One WebSocket per client** (a browser tab, the Runner) to
  `/api/ws`, authenticated by the session cookie (a tab) or the Runner's
  token. Commands that change the state are REST
  ([ADR 0008](0008-conventions.md)); the socket carries events, the
  encrypted relay between tabs and the Runner, the tab's visibility and the
  heartbeats.
- **Events are numbered per Pilote**: every change of the Process's state
  writes an `events` row (`pilotId`, `seq`, `type`, `payload`, `at`) in the
  same transaction as the change, `seq` taken from a counter on the
  Pilote's row. The payload is the changed resource as the API returns it.
  Events are kept 7 days.
- **Connecting**: the client sends the last `seq` it applied. The server
  replays what follows, then streams; a `seq` it no longer has, or none,
  gets a **snapshot** (`GET /api/state`: everything the page shows, with the
  `seq` it reflects). Until the snapshot or the replay is applied, the page
  is in **Resynchronisation**: « resynchronisation… » shown, every
  **Action sensible** disabled with its reason. A REST command that carries
  an older `seq` than the resource's last change gets 409.
- **Sources**: GitHub webhooks ([ADR 0002](0002-github-app.md)), the
  Runner's reports, the Pilote's commands, the scheduler. Each becomes the
  same kind of event; nothing polls on the page.
- **The relay**: a Session's messages are ciphertext the server passes from
  the Runner to the tabs that opened the Session, and back, never stored
  ([ADR 0003](0003-privacy-and-end-to-end-encryption.md)). Opening a Session
  asks the Runner to replay it from its local log.
- **Visibility and push**: each tab sends `visibility` on every
  `visibilitychange`. When a Décision is created, the server sends a push
  at once if no tab has been visible for 2 min; else it checks again 2 min
  after the last visible tab hides, and pushes the Décisions still waiting.
- **Web Push** (VAPID, `web-push`) to the installable PWA (on iOS 16.4+,
  added to the home screen). The payload is the Décision's title and its
  link; Idées give a generic title. The Paramètres' « Notifications push »
  registers the Appareil's subscription.
- **Dictation** (US-57): the browser's Web Speech API, its transcript
  filling the field to correct before sending; the button is hidden where
  the API is missing (keyboard dictation still works).
- **The p95 is measured**: each event carries the time its source saw the
  change (webhook delivery, Runner report); the page reports the delay to
  `POST /api/metrics/latency` in batches, and the statistics' health shows
  the p95 of the last 7 days.

## Options that lost

- **SSE for the tabs, a WebSocket for the Runner**: two transports and two
  resynchronisations, while the tabs also send (visibility, relay).
- **Event sourcing**: the tables are the truth, the events only tell the
  clients what changed.
- **ntfy** (the console's): an app to install for each Pilote.
- **Whisper on the Runner** for dictation: needs the Runner online and a
  model to download; reconsider if Web Speech proves poor on the phone.

## Consequences

- Tests drive the socket with a fake client (`apps/server/test/fakes/ws-client.ts`)
  and assert the replay and the snapshot; the page's resynchronisation is a
  Playwright test that cuts the socket.
- The first files to imitate: `apps/server/src/realtime/` (the gateway and
  the events writer), `apps/web/src/store/` (applying an event).
