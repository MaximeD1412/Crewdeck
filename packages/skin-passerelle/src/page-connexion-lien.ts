import { PageConnexionLien, t } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-page-connexion-lien`: the page a sign-in link opens, inside the bare
 * Cadre, laid out as `cd-page-connexion`. Its primary « Se connecter » emits
 * `confirm` (loading while `busy`); a link no longer valid shows the halt
 * Banner and the primary « Recevoir un nouveau lien » (`restart`).
 */
export class PasserellePageConnexionLien extends PasserelleElement<typeof PageConnexionLien> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        padding-top: var(--cd-space-10);
      }
      h1 {
        font: var(--cd-font-page-title-weight) var(--cd-font-page-title-size) / var(--cd-font-page-title-line-height)
          var(--cd-font-page-title-family), sans-serif;
        letter-spacing: var(--cd-font-page-title-letter-spacing);
        color: var(--cd-ink);
      }
      p {
        color: var(--cd-ink-2);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      cd-button {
        display: flex;
      }
      cd-button::part(button) {
        width: 100%;
      }
    `,
  ];

  protected readonly composant = PageConnexionLien;

  protected override render() {
    const { state } = this.data;
    const body =
      state === 'invalid'
        ? html`<cd-banner part="invalid" .data=${{ tone: 'halt', title: t('connexionLien.invalid') }}></cd-banner>
            <cd-button
              part="restart"
              class="restart"
              .data=${{ label: t('connexionLien.restart'), variant: 'primary', size: 'md', icon: 'send' }}
              @click=${() => this.emit('restart', {})}
            ></cd-button>`
        : html`<cd-button
            part="confirm"
            class="confirm"
            .data=${{ label: t('connexionLien.confirm'), variant: 'primary', size: 'md', ...(state === 'busy' ? { state: 'loading' } : {}) }}
            @click=${() => this.emit('confirm', {})}
          ></cd-button>`;
    return html`
      <h1 part="title">${t('connexionLien.title')}</h1>
      <p part="lead">${t('connexionLien.lead')}</p>
      ${body}
    `;
  }
}
