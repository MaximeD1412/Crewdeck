import { Capture, t } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-capture`: a capture framed with its caption, `--cd-capture-w` or
 * `--cd-capture-w-lg` wide at most. The image is a button that asks to
 * enlarge it (`open`); its `src` is the object URL the core built, never
 * fetched by the Composant.
 */
export class PasserelleCapture extends PasserelleElement<typeof Capture> {
  static override styles = [
    sharedStyles,
    css`
      figure {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
        width: min(100%, var(--cd-capture-w));
      }
      figure.lg {
        width: min(100%, var(--cd-capture-w-lg));
      }
      button {
        display: block;
        cursor: zoom-in;
        border-radius: var(--cd-radius);
      }
      img {
        display: block;
        width: 100%;
        height: auto;
        border: thin solid var(--cd-line-strong);
        border-radius: var(--cd-radius);
        background: var(--cd-side);
      }
      figcaption {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
    `,
  ];

  protected readonly composant = Capture;

  protected override render() {
    const { src, alt, label, size } = this.data;
    return html`<figure class=${size} part="capture">
      <button type="button" aria-label=${t('capture.open', { label })} @click=${() => this.emit('open', { src })}>
        <img src=${src} alt=${alt} />
      </button>
      <figcaption>${label}</figcaption>
    </figure>`;
  }
}
