import { Composer, t } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-composer`: a textarea named by its placeholder. Enter sends its text
 * (trimmed, nothing when blank) and clears it, Shift+Enter breaks a line, as
 * does Enter while an input method composes. Its mic, only with `dictation`,
 * asks to dictate or to stop; the core puts the transcript in `value`, which
 * replaces the field's text each time it changes.
 */
export class PasserelleComposer extends PasserelleElement<typeof Composer> {
  static override properties = { text: { state: true } };
  static override styles = [
    sharedStyles,
    css`
      .composer {
        padding: var(--cd-space-3);
        background: var(--cd-panel);
        border-top: thin solid var(--cd-line);
      }
      .box {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
        padding: var(--cd-space-3);
        border: thin solid var(--cd-line-strong);
        border-radius: var(--cd-radius-lg);
        background: var(--cd-side);
      }
      .box:focus-within {
        border-color: var(--cd-accent);
      }
      .dictating .box {
        border-color: var(--cd-halt);
      }
      textarea {
        display: block;
        width: 100%;
        min-height: var(--cd-font-body-line-height);
        max-height: 40vh;
        field-sizing: content;
        resize: none;
        padding: 0;
        border: 0;
        background: none;
        color: var(--cd-ink);
        font: inherit;
      }
      textarea::placeholder {
        color: var(--cd-muted);
        opacity: 1;
      }
      textarea:focus {
        outline: none;
      }
      /* Disabled, its controls dim, not its hint: text keeps its contrast. */
      textarea:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .tools {
        display: flex;
        align-items: center;
        gap: var(--cd-space-2);
      }
      .hint,
      .recording {
        margin-right: auto;
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-2);
        color: var(--cd-muted);
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
      }
      .recording {
        color: var(--cd-halt);
      }
      .tools button {
        display: grid;
        place-items: center;
        width: var(--cd-touch);
        height: var(--cd-touch);
        border-radius: var(--cd-radius);
        flex: none;
      }
      .mic {
        background: var(--cd-sunk);
        color: var(--cd-ink-2);
      }
      .mic[aria-pressed='true'] {
        background: var(--cd-halt-soft);
        color: var(--cd-halt);
      }
      .send {
        background: var(--cd-accent);
        color: var(--cd-accent-ink);
      }
      .send:hover:enabled {
        background: var(--cd-accent-hover);
      }
      .tools button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      /* A phone has no Enter to hint at: the hint keeps its room, hidden. */
      .hint {
        visibility: hidden;
      }
      @media (min-width: 1280px) {
        .hint {
          visibility: visible;
        }
      }
    `,
  ];

  protected readonly composant = Composer;
  /** What the field holds: `value` each time the core changes it, then what the Pilote types. */
  declare text: string;

  constructor() {
    super();
    this.text = '';
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    const previous = changed.get('data') as typeof this.data | undefined;
    if (changed.has('data') && this.data.value !== previous?.value) this.text = this.data.value;
  }

  private send() {
    const text = this.text.trim();
    if (this.data.state === 'disabled' || text === '') return;
    this.emit('send', { text });
    this.text = '';
  }

  private onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.send();
  }

  protected override render() {
    const { placeholder, hint, state, dictation } = this.data;
    const dictating = state === 'dictating';
    const disabled = state === 'disabled';
    return html`<div part="composer" class="composer ${state}">
      <div class="box">
        <textarea
          rows="1"
          placeholder=${placeholder}
          aria-label=${placeholder}
          ?disabled=${disabled}
          .value=${live(this.text)}
          @input=${(event: Event) => (this.text = (event.target as HTMLTextAreaElement).value)}
          @keydown=${(event: KeyboardEvent) => this.onKeydown(event)}
        ></textarea>
        <div class="tools">
          ${dictating
            ? html`<span class="recording" role="status"
                ><cd-status-dot .data=${{ tone: 'halt', pulse: true, label: t('composer.dictating') }}></cd-status-dot
                ><span aria-hidden="true">${t('composer.dictating')}</span></span
              >`
            : html`<span class="hint">${hint ?? t('composer.hint')}</span>`}
          ${dictation
            ? html`<button
                type="button"
                class="mic"
                aria-label=${dictating ? t('composer.stopDictation') : t('composer.dictate')}
                aria-pressed=${dictating ? 'true' : 'false'}
                ?disabled=${disabled}
                @click=${() => (dictating ? this.emit('stopDictation', {}) : this.emit('dictate', {}))}
              >
                <cd-icon .data=${{ name: dictating ? 'stop' : 'mic', size: 'md' }}></cd-icon>
              </button>`
            : nothing}
          <button type="button" class="send" aria-label=${t('composer.send')} ?disabled=${disabled} @click=${() => this.send()}>
            <cd-icon .data=${{ name: 'send', size: 'md' }}></cd-icon>
          </button>
        </div>
      </div>
    </div>`;
  }
}
