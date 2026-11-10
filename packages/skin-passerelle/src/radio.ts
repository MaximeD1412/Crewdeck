import { Radio } from '@crewdeck/sdk';
import { css, html, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import { sharedStyles } from './base.js';
import { choiceStyles } from './choice.js';
import { PasserelleFormElement } from './form.js';

const NEXT: Readonly<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/**
 * `cd-radio`: a native radio inside its label. Each sits in its own shadow
 * root, where the browser sees a group of one, so the group is kept here: the
 * `cd-radio`s of the same `name` and form in the same document or shadow
 * root. One of them is checked and submits its `value`; only it (or the first)
 * is in the tab order; the arrow keys check and focus the next or previous.
 */
export class PasserelleRadio extends PasserelleFormElement<typeof Radio> {
  static override styles = [
    sharedStyles,
    choiceStyles,
    css`
      input {
        border-radius: var(--cd-radius-full);
      }
      input:checked {
        border-color: var(--cd-accent);
      }
      input:checked::after {
        content: '';
        width: var(--cd-space-2);
        height: var(--cd-space-2);
        border-radius: var(--cd-radius-full);
        background: var(--cd-accent);
      }
    `,
  ];

  protected readonly composant = Radio;

  private current = false;

  get checked(): boolean {
    return this.current;
  }

  get value(): string {
    return this.data.value;
  }

  /** The group, this one included, in the document's order. */
  private group(): PasserelleRadio[] {
    const root = this.getRootNode() as Document | ShadowRoot;
    return [...root.querySelectorAll(this.localName)].filter(
      (peer): peer is PasserelleRadio =>
        peer instanceof PasserelleRadio && peer.data !== undefined && peer.data.name === this.data.name && peer.form === this.form,
    );
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (this.dataChanged(changed, 'checked')) this.current = this.data.checked;
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.submit(this.data.name, this.current ? this.data.value : null);
    // The others' tab stop depends on this one.
    if (changed.has('data')) for (const peer of this.group()) if (peer !== this) peer.requestUpdate();
  }

  /** At once, as a native group does: the input, the tab stop and the form, then the render. */
  private setChecked(checked: boolean) {
    this.current = checked;
    this.submit(this.data.name, checked ? this.data.value : null);
    const input = this.shadowRoot?.querySelector('input');
    if (input) input.checked = checked;
    this.requestUpdate();
  }

  /** Checks this one and unchecks the rest of its group, as a native group does. */
  private check() {
    const group = this.group();
    for (const peer of group) peer.setChecked(peer === this);
    for (const peer of group) peer.syncTabStop();
    this.forwardChange();
  }

  private syncTabStop() {
    const input = this.shadowRoot?.querySelector('input');
    if (input) input.tabIndex = this.tabStop() ? 0 : -1;
  }

  private onKeydown(event: KeyboardEvent) {
    const step = NEXT[event.key];
    if (!step) return;
    event.preventDefault();
    const group = this.group();
    const next = group[(group.indexOf(this) + step + group.length) % group.length];
    if (!next || next === this) return;
    next.check();
    next.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    next.shadowRoot?.querySelector('input')?.focus();
  }

  private tabStop(): boolean {
    const group = this.group();
    return this.current || (!group.some((peer) => peer.checked) && group[0] === this);
  }

  protected override render() {
    return html`<label part="choice">
      <input
        part="control"
        type="radio"
        name=${this.data.name}
        .value=${this.data.value}
        .checked=${live(this.current)}
        tabindex=${this.tabStop() ? '0' : '-1'}
        @change=${this.check}
        @keydown=${this.onKeydown}
      />
      <span part="label">${this.data.label}</span>
    </label>`;
  }
}
