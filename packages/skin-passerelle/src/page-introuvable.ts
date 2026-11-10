import { PageIntrouvable, t } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-page-introuvable`: an unknown URL, with the way back to « À toi ». */
export class PasserellePageIntrouvable extends PasserelleElement<typeof PageIntrouvable> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--cd-space-3);
        padding: var(--cd-space-10) var(--cd-space-4);
        text-align: center;
      }
      h1 {
        margin: 0;
        font: var(--cd-font-page-title-weight) var(--cd-font-page-title-size) / var(--cd-font-page-title-line-height)
          var(--cd-font-page-title-family), sans-serif;
        letter-spacing: var(--cd-font-page-title-letter-spacing);
      }
      a {
        display: inline-flex;
        align-items: center;
        min-height: var(--cd-touch);
        font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
      }
    `,
  ];

  protected readonly composant = PageIntrouvable;

  protected override render() {
    return html`
      <h1 part="title">${t('router.notFound.title')}</h1>
      <a part="back" href="/a-toi">${t('router.notFound.back')}</a>
    `;
  }
}
