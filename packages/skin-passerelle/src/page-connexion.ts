import { PageConnexion, t } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-page-connexion`: the welcome, inside the bare Cadre (`design/screens/crewdeck/connexion.html`),
 * the wide « Continuer avec GitHub » button, which emits `signIn`, and its help;
 * after a failed attempt, a halt Banner above the button says why.
 */
export class PasserellePageConnexion extends PasserelleElement<typeof PageConnexion> {
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
      .help {
        color: var(--cd-muted);
      }
      cd-button {
        display: flex;
      }
      cd-button::part(button) {
        width: 100%;
      }
    `,
  ];

  protected readonly composant = PageConnexion;

  protected override render() {
    const { error } = this.data;
    return html`
      <h1 part="title">${t('connexion.title')}</h1>
      <p part="lead">${t('connexion.lead')}</p>
      ${error ? html`<cd-banner part="error" .data=${{ tone: 'halt', title: t(`connexion.error.${error}`) }}></cd-banner>` : nothing}
      <cd-button
        part="sign-in"
        .data=${{ label: t('connexion.button'), variant: 'primary', size: 'md', icon: 'github' }}
        @click=${() => this.emit('signIn', {})}
      ></cd-button>
      <p part="help" class="help">${t('connexion.help')}</p>
    `;
  }
}
