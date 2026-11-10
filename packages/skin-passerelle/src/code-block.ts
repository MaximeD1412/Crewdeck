import { CodeBlock, t } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** How long « Copié » stays. */
export const COPIED_MS = 2000;

/** `cd-code-block`: a command and « Copier », which copies it and says « Copié » for 2 s; a local behaviour, no action. */
export class PasserelleCodeBlock extends PasserelleElement<typeof CodeBlock> {
  static override properties = { copied: { state: true } };
  static override styles = [
    sharedStyles,
    css`
      .code {
        display: flex;
        align-items: center;
        gap: var(--cd-space-2);
        background: var(--cd-side);
        border: thin solid var(--cd-line);
        border-radius: var(--cd-radius);
        padding: var(--cd-space-2) var(--cd-space-2) var(--cd-space-2) var(--cd-space-3);
      }
      code {
        flex: 1;
        min-width: 0;
        color: var(--cd-ink);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      button {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-1);
        height: var(--cd-control-sm);
        padding: 0 var(--cd-space-3);
        border-radius: var(--cd-radius);
        background: var(--cd-sunk);
        color: var(--cd-ink-2);
        font: var(--cd-font-label-weight) var(--cd-font-caption-size) / 1 var(--cd-font-label-family), sans-serif;
        flex: none;
      }
      button::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        height: var(--cd-touch);
        transform: translateY(-50%);
      }
      @media (min-width: 1280px) {
        code {
          white-space: nowrap;
          overflow-x: auto;
          scrollbar-width: none;
        }
      }
    `,
  ];

  protected readonly composant = CodeBlock;
  declare copied: boolean;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.copied = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.timer);
    this.copied = false;
  }

  private async copy() {
    try {
      await navigator.clipboard.writeText(this.data.code);
    } catch {
      return;
    }
    clearTimeout(this.timer);
    this.copied = true;
    this.timer = setTimeout(() => (this.copied = false), COPIED_MS);
  }

  protected override render() {
    return html`<div part="code" class="code">
      <code>${this.data.code}</code>
      <button type="button" @click=${() => void this.copy()}>
        <cd-icon .data=${{ name: this.copied ? 'check' : 'copy', size: 'sm' }}></cd-icon>
        ${this.copied ? t('codeBlock.copied') : t('codeBlock.copy')}
      </button>
      <span class="visually-hidden" role="status">${this.copied ? t('codeBlock.copied') : ''}</span>
    </div>`;
  }
}
