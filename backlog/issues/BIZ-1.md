---
id: BIZ-1
title: "Check that the name « Crewdeck » is free (trademark, domain), buy the domain and set its DNS"
epic: BIZ
type: externe
priority: P0
size: S
milestone: M0 Skeleton and delivery
blocked_by: []
adr: [0009]
risques: [BIZ-2]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

The PRD's « Open questions » asks whether the name « Crewdeck » is free (trademark, domain), « the founder, before the sign-up page ». ADR 0009 lists « buy the domain (after the name check) and its DNS » among the `externe` tickets. The domain is in every URL of the product: the GitHub Apps' callbacks and webhooks (INFRA-11), the Caddy edge (INFRA-5), the Runner's install command (`https://<domain>/runner/install.sh`, ADR 0004), the sign-up page (BIZ-2).

## Current state of the code

- No domain anywhere: the docs write `<domain>` (ADR 0004, ADR 0009); `infra/edge/edge.env.example` (INFRA-5) reads `CREWDECK_DOMAIN`.

## To do

- [ ] Trademark search for « Crewdeck » (and close spellings « Crew Deck », « Krewdeck ») in classes 9 and 42: INPI (base marques), EUIPO (TMview, covers EU and national offices), WIPO Global Brand Database, USPTO. Note any live mark in these classes for software.
- [ ] Look for software products already named Crewdeck (search engines, GitHub, Product Hunt, app stores).
- [ ] Check the domains: `crewdeck.com`, `crewdeck.dev`, `crewdeck.app`, `crewdeck.io`, and the GitHub organisation `crewdeck`.
- [ ] Decide:
  - name free: buy one domain (reco `crewdeck.dev` or `crewdeck.app` if `.com` is taken; HTTPS-only TLDs suit the product), with auto-renewal, at a registrar with an API-free DNS editor (OVH, as for the VPS, or another); WHOIS privacy on;
  - name taken: stop, write a comment here with the findings; renaming is a PRD and glossary change (skill `product-design --amend`), then this ticket is redone with the new name.
- [ ] DNS now: nothing for the server yet (INFRA-12 adds `A`/`AAAA` once the VPS exists); `CNAME inscription.<domain>` for BIZ-2's page when its tool gives the target.
- [ ] Optionally register « Crewdeck » as an EU trademark (classes 9 and 42) if the founder wants it; not blocking.
- [ ] Comment on this ticket: the domain bought, the registrar, the date, the trademark findings (one line each). Update `docs/pilotage/risques.json` BIZ-2 (status, `statutDepuis`) through a PR or an agent.

## Decisions already made

- The product's server lives at the domain's root (`https://<domain>`), staging at `staging.<domain>` (ADR 0009, INFRA-5), the sign-up page at `inscription.<domain>` (BIZ-2): no DNS move when the product goes live.

## Acceptance criteria

- [ ] The trademark and product searches are written in a comment of this ticket.
- [ ] A domain is bought with auto-renewal, or the ticket is closed with « nom pris » and the findings.

## Verification

- `dig +short NS <domain>` returns the registrar's name servers.

## For prod

`docs/pilotage/mep.json`: the domain, its registrar and renewal date.

## Out of scope

- Server DNS records: INFRA-12. The sign-up page: BIZ-2.

## Dependencies

None.
