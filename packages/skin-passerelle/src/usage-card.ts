import { t, UsageCard, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Account = ComposantData<typeof UsageCard>['accounts'][number];

/**
 * `cd-usage-card`: the usage of the Comptes IA (`design/screens/crewdeck/runner.html`,
 * « Usage des Comptes IA »), a `cd-card` holding each Compte IA: its title as
 * a sub-heading, its note, a `cd-usage-meter` per window, an API key's
 * « Dépense estimée du mois ». Without a title (« À toi », compact), the note
 * closes the Compte IA.
 */
export class PasserelleUsageCard extends PasserelleElement<typeof UsageCard> {
  static override styles = [
    sharedStyles,
    css`
      .account {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-3);
      }
      .account + .account {
        margin-top: var(--cd-space-2);
      }
      h3 {
        margin: 0;
        font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
        color: var(--cd-ink);
      }
      h3 + * {
        margin-top: calc(var(--cd-space-1) * -1);
      }
      .note {
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-ink-2);
      }
      .account.compact .note {
        color: var(--cd-muted);
      }
    `,
  ];

  protected readonly composant = UsageCard;

  private account({ title, meters, monthSpend, note }: Account) {
    const noteLine = note === null ? nothing : html`<p class="note">${note}</p>`;
    return html`<div class="account ${title === null ? 'compact' : ''}">
      ${title === null ? nothing : html`<h3>${title}</h3>${noteLine}`}
      ${meters.map((meter) => html`<cd-usage-meter .data=${meter}></cd-usage-meter>`)}
      ${monthSpend === null
        ? nothing
        : html`<cd-key-value .data=${{ items: [{ label: t('usage.monthSpend'), value: monthSpend, mono: false }] }}></cd-key-value>`}
      ${title === null ? noteLine : nothing}
    </div>`;
  }

  protected override render() {
    const { title, accounts } = this.data;
    return html`<cd-card .data=${{ title, label: title }}>${accounts.map((account) => this.account(account))}</cd-card>`;
  }
}
