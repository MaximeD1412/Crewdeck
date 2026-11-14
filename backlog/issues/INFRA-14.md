---
id: INFRA-14
title: "Mail: the Brevo account, the sender domain authenticated (SPF, DKIM, DMARC), one SMTP key per environment and SMTP_URL, MAIL_FROM on the VPS"
epic: INFRA
type: externe
priority: P1
size: S
milestone: M0 Skeleton and delivery
blocked_by: []
adr: [0014, 0009]
risques: []
stories: []
screens: []
revue_visuelle: false
video: false
hors_boucle: true
---

## Context

ADR 0014: a Pilote can sign in with a link sent by email (US-1, CORE-9), so that they need no GitHub account. The server sends it through SMTP (`nodemailer`), the provider being Brevo at the MVP (EU, swapped by changing `SMTP_URL`). A sign-in mail that lands in spam is a sign-in that fails: the sender domain must be authenticated (SPF, DKIM, DMARC) before the first Pilote uses it. Code never sends a real mail in tests (CORE-9's fake transport); this ticket is the founder's gesture that lets staging and production send. Values are never committed (ADR 0009, « Secrets »); each secret has its copy in the password manager.

## Current state of the code

- No mail code on `develop`; `apps/server/src/config/env.ts` (`zEnv`) has no mail key.
- Created by CORE-9: `SMTP_URL` and `MAIL_FROM` in `zEnv` (required in production and staging, the boot refusing to start without them) and in `infra/deploy/prod.env.example` and `staging.env.example`; the sign-in mail « Ton lien de connexion à Crewdeck » sent from `MAIL_FROM`.
- Created by INFRA-12: the DNS of `<domain>` at the registrar, `/opt/crewdeck/prod/.env` and `/opt/crewdeck/staging/.env` (mode 600, owner `deploy`).

## To do

Gestures of the founder, in order (`<domain>` from BIZ-1, `<ip>` the VPS's IPv4 from INFRA-10):

- [ ] **Account**: create a Brevo account (free plan) with the founder's address; company « Crewdeck »; no marketing list, no contact import.
- [ ] **Sender domain**: Brevo > « Senders, Domains & Dedicated IPs » > « Domains » > « Add a domain » `<domain>`, « Authenticate the domain yourself ». At the registrar, add exactly the records Brevo shows: the `brevo-code` TXT on `@`, the DKIM record(s) on their `…._domainkey` host, the DMARC TXT on `_dmarc` (`v=DMARC1; p=none; rua=mailto:…` as Brevo proposes it, then `p=quarantine` once a week of reports shows only Brevo sending). SPF: if `<domain>` already has a `v=spf1` TXT, add `include:spf.brevo.com` to it, else create `v=spf1 include:spf.brevo.com ~all`; never two SPF records. TTL 300 until Brevo shows the domain « Authenticated ».
- [ ] **Sender**: Brevo > « Senders » > « Add a sender »: name « Crewdeck », address `connexion@<domain>`. The address need not receive mail (Brevo verifies it through the authenticated domain).
- [ ] **SMTP keys**: Brevo > « Settings » > « SMTP & API » > « SMTP » > « Generate a new SMTP key », one named `crewdeck-staging`, one `crewdeck-production`. Note the SMTP login shown on that page (`…@smtp-brevo.com`), the same for both.
- [ ] **Authorized IPs**: Brevo > « Security » > « Authorized IPs »: add `<ip>`, then on the « SMTP » tab activate it for the SMTP keys, so that a leaked key sends nothing from elsewhere.
- [ ] **Check each key** from the VPS before writing it anywhere (a test mail to the founder's address):

  ```sh
  printf 'From: connexion@<domain>\r\nTo: <founder>\r\nSubject: Test Crewdeck <env>\r\n\r\nTest SMTP.\r\n' > /tmp/test-mail.txt
  curl --ssl-reqd --url 'smtp://smtp-relay.brevo.com:587' --user '<login>:<key>' \
    --mail-from 'connexion@<domain>' --mail-rcpt '<founder>' --upload-file /tmp/test-mail.txt
  rm /tmp/test-mail.txt
  ```

  The mail arrives in the inbox (not spam); « Show original » says `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
- [ ] **Env files** on the VPS (once INFRA-12 wrote them; if not yet, the values wait in the password manager and INFRA-12 writes them):
  - `/opt/crewdeck/staging/.env`: `SMTP_URL=smtp://<login>:<staging key, URL-encoded>@smtp-relay.brevo.com:587`, `MAIL_FROM=Crewdeck staging <connexion@<domain>>`;
  - `/opt/crewdeck/prod/.env`: `SMTP_URL=smtp://<login>:<production key, URL-encoded>@smtp-relay.brevo.com:587`, `MAIL_FROM=Crewdeck <connexion@<domain>>`.
  The keys contain characters that must be percent-encoded in a URL (`python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' '<key>'`).
- [ ] **Password manager**: one entry « Crewdeck Brevo » (account, SMTP login, both keys, the DNS records added).
- [ ] Once CORE-9 is deployed on staging: on `https://staging.<domain>/connexion`, ask a link for the founder's address; it arrives within a minute, its link opens `/connexion/lien` on staging.
- [ ] Update `docs/pilotage/mep.json`: CORE-9's items about `SMTP_URL` and `MAIL_FROM` done (a PR, or ask an agent).
- [ ] Comment on this ticket: done, the date, the sender address; never a key.

## Decisions already made

- Brevo at the MVP (ADR 0014): EU-hosted, SMTP common to every provider; its free plan's 300 mails a day covers the founder's use and the Bêta's first Pilotes. A change of provider is a new `SMTP_URL`, no code.
- One account for both environments, one SMTP key each: a staging key never sends as production, and revoking one leaves the other.
- Port 587 with STARTTLS (`smtp://`, nodemailer upgrades the connection), never port 25 nor plain text.
- The sign-in mail is the only mail Crewdeck sends at the MVP: no marketing, no tracking of opens or clicks (Brevo's tracking is off for transactional SMTP mails by default; leave it off).

## Acceptance criteria

- [ ] Brevo shows `<domain>` « Authenticated »; `dig +short TXT _dmarc.<domain>` and the SPF TXT answer as above.
- [ ] A test mail sent with each key from the VPS reaches the founder's inbox with SPF, DKIM and DMARC passing; the same `curl` from another IP is refused.
- [ ] `SMTP_URL` and `MAIL_FROM` are in each env file (mode 600) and in the password manager, nowhere else.

## Verification

- `dig +short TXT <domain>`, `dig +short TXT _dmarc.<domain>`, `dig +short TXT <the DKIM host>.<domain>`
- `sudo grep -c '^SMTP_URL=smtp://.\+' /opt/crewdeck/prod/.env /opt/crewdeck/staging/.env`

## For prod

This ticket is the release's gestures for mail; `docs/pilotage/mep.json` updated as above.

## Out of scope

- The mailer, the template and the fake transport: CORE-9. The Google OAuth clients: INFRA-15. The DNS of the site itself: INFRA-12.

## Dependencies

- None. The domain comes from BIZ-1 and the env files from INFRA-12, both done before this gesture in practice; without them the values wait in the password manager.
