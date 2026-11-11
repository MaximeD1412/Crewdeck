import { Question, t } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues } from 'lit';
import { askStyles } from './ask.js';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-question`: its kicker, its title, its options as native radios (the
 * arrow keys move between them) or checkboxes when `multiple`, then
 * « Répondre », which emits `answer` with the chosen ids; disabled while none is.
 * The choice starts from the options' `selected` and stays here until then.
 */
export class PasserelleQuestion extends PasserelleElement<typeof Question> {
  static override properties = { chosen: { state: true } };
  static override styles = [
    sharedStyles,
    askStyles,
    css`
      .options {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
      }
      label {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--cd-space-3);
        min-height: var(--cd-touch);
        padding: var(--cd-space-3);
        border: thin solid var(--cd-control-border);
        border-radius: var(--cd-radius);
        cursor: pointer;
      }
      label:hover {
        background: var(--cd-sunk);
      }
      label:has(input:checked) {
        border-color: var(--cd-accent);
        background: var(--cd-accent-soft);
      }
      .mark {
        position: relative;
        display: grid;
        place-items: center;
        width: var(--cd-icon-sm);
        height: var(--cd-icon-sm);
        margin-top: var(--cd-space-1);
        color: var(--cd-accent-ink);
      }
      input {
        appearance: none;
        margin: 0;
        width: 100%;
        height: 100%;
        border: var(--cd-stroke) solid var(--cd-control-border);
        border-radius: var(--cd-radius-full);
        cursor: pointer;
      }
      input[type='checkbox'] {
        border-radius: var(--cd-radius-sm);
      }
      input:checked {
        background: var(--cd-accent);
        border-color: var(--cd-accent);
      }
      input:focus-visible {
        outline: var(--cd-stroke) solid var(--cd-accent);
        outline-offset: var(--cd-stroke);
      }
      .mark cd-icon {
        position: absolute;
        pointer-events: none;
        display: none;
        --cd-icon-sm: var(--cd-space-3);
      }
      input:checked + cd-icon {
        display: block;
      }
      .option {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
      }
      .label {
        color: var(--cd-ink);
        font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
      }
      .detail {
        color: var(--cd-ink-2);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
    `,
  ];

  protected readonly composant = Question;
  /** The ids the Pilote has chosen, in the options' order. */
  declare chosen: readonly string[];

  constructor() {
    super();
    this.chosen = [];
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('data')) this.chosen = this.data.options.filter((option) => option.selected).map((option) => option.id);
  }

  private choose(id: string, checked: boolean) {
    const { options, multiple } = this.data;
    const next = multiple ? new Set(this.chosen) : new Set<string>();
    if (checked) next.add(id);
    else next.delete(id);
    this.chosen = options.filter((option) => next.has(option.id)).map((option) => option.id);
  }

  private answer() {
    if (this.chosen.length > 0) this.emit('answer', { questionId: this.data.id, optionIds: [...this.chosen] });
  }

  protected override render() {
    const { id, kicker, title, options, multiple } = this.data;
    const type = multiple ? 'checkbox' : 'radio';
    return html`<div part="question" class="ask">
      <p class="kicker"><cd-icon .data=${{ name: 'info', size: 'sm' }}></cd-icon>${kicker ?? t('question.kicker')}</p>
      <h3 id="title">${title}</h3>
      <div class="options" role=${multiple ? 'group' : 'radiogroup'} aria-labelledby="title">
        ${options.map(
          (option, index) =>
            html`<label>
              <span class="mark">
                <input
                  type=${type}
                  name=${id}
                  value=${option.id}
                  .checked=${this.chosen.includes(option.id)}
                  aria-describedby=${option.detail === null ? nothing : `detail-${index}`}
                  @change=${(event: Event) => this.choose(option.id, (event.target as HTMLInputElement).checked)}
                />
                <cd-icon .data=${{ name: 'check', size: 'sm' }}></cd-icon>
              </span>
              <span class="option">
                <span class="label">${option.label}</span>
                ${option.detail === null
                  ? nothing
                  : html`<span class="detail" id=${`detail-${index}`}>${option.detail}</span>`}
              </span>
            </label>`,
        )}
      </div>
      <div class="buttons">
        <cd-button
          class="answer"
          .data=${{
            label: t('question.answer'),
            variant: 'primary',
            size: 'sm',
            ...(this.chosen.length === 0 ? { state: 'disabled' } : {}),
          }}
          @click=${() => this.answer()}
        ></cd-button>
      </div>
    </div>`;
  }
}
