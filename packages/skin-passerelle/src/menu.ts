import { Menu, t } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** The keys that move the focus, from the index of the focused enabled item. */
const MOVES: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowDown: (i, n) => (i + 1) % n,
  ArrowUp: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

/**
 * `cd-menu`: a WAI-ARIA menu, named by its title above it, a group per group
 * named by its label, a `menuitem` per item: its icon, its label in bold over
 * its detail, a check when selected (« choisi » for a screen reader). A
 * disabled item is `aria-disabled` and chooses nothing. The focus goes to the
 * first enabled item when it opens; the arrows, Home and End move it over the
 * enabled ones, wrapping; only the focused item is in the tab order. Enter,
 * Space or a click emit `choose`; Escape or a pointer down outside it emit
 * `close`: the core removes it.
 */
export class PasserelleMenu extends PasserelleElement<typeof Menu> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        width: var(--cd-menu-width);
        max-width: 100%;
      }
      .menu {
        display: flex;
        flex-direction: column;
        padding: var(--cd-space-1) 0;
        background: var(--cd-raised);
        border: thin solid var(--cd-line-strong);
        border-radius: var(--cd-radius-lg);
        box-shadow: 0 var(--cd-space-2) var(--cd-space-6) var(--cd-shadow);
      }
      .title {
        padding: var(--cd-space-1) var(--cd-space-4) var(--cd-space-2);
        font: var(--cd-font-section-label-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
            var(--cd-font-section-label-family),
          sans-serif;
        letter-spacing: var(--cd-font-section-label-letter-spacing);
        text-transform: uppercase;
        color: var(--cd-muted);
      }
      [role='group'] {
        display: flex;
        flex-direction: column;
        padding: var(--cd-space-1) 0;
      }
      .title + [role='menu'] > [role='group']:first-child,
      [role='group'] + [role='group'] {
        border-top: thin solid var(--cd-line);
      }
      .label {
        padding: var(--cd-space-1) var(--cd-space-4);
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
        color: var(--cd-muted);
      }
      [role='menuitem'] {
        width: 100%;
        min-height: var(--cd-touch);
        display: flex;
        align-items: flex-start;
        gap: var(--cd-space-3);
        padding: var(--cd-space-1) var(--cd-space-4);
        text-align: left;
      }
      [role='menuitem']:focus-visible {
        outline-offset: calc(var(--cd-stroke) * -1);
      }
      [role='menuitem']:hover:not([aria-disabled]) {
        background: var(--cd-sunk);
      }
      [role='menuitem'][aria-disabled] {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .icon {
        color: var(--cd-muted);
        margin-top: var(--cd-space-1);
      }
      .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      b {
        font: var(--cd-font-label-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-label-family), sans-serif;
        color: var(--cd-ink);
      }
      .detail {
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
        color: var(--cd-muted);
      }
      .selected b,
      .check {
        color: var(--cd-accent-text);
      }
      .check {
        margin-top: var(--cd-space-1);
      }
    `,
  ];

  protected readonly composant = Menu;

  /**
   * The id of the item in the tab order; the first enabled one by default.
   * Not reactive: moving it sets the items' `tabindex` at once.
   */
  private active: string | null = null;

  private readonly onPointerdown = (event: PointerEvent) => {
    if (!event.composedPath().includes(this)) this.emit('close', {});
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.onPointerdown);
  }

  override disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.onPointerdown);
    super.disconnectedCallback();
  }

  /** The enabled items' ids, in order. */
  private enabled(): string[] {
    return this.data.groups.flatMap((group) => group.items.filter((item) => !item.disabled).map((item) => item.id));
  }

  private current(): string | null {
    const enabled = this.enabled();
    return this.active !== null && enabled.includes(this.active) ? this.active : (enabled[0] ?? null);
  }

  /** Puts the item `id` alone in the tab order. */
  private activate(id: string) {
    this.active = id;
    for (const node of this.shadowRoot?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []) {
      node.tabIndex = node.dataset['id'] === id ? 0 : -1;
    }
  }

  private item(id: string): HTMLElement | null {
    return this.shadowRoot?.querySelector<HTMLElement>(`[role=menuitem][data-id="${CSS.escape(id)}"]`) ?? null;
  }

  protected override firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    const first = this.current();
    if (first !== null) this.item(first)?.focus({ preventScroll: true });
  }

  private choose(id: string) {
    const item = this.data.groups.flatMap((group) => group.items).find((candidate) => candidate.id === id);
    if (item && !item.disabled) this.emit('choose', { id });
  }

  private onKeydown(event: KeyboardEvent) {
    const target = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.dataset['id'] !== undefined);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.emit('close', {});
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (target?.dataset['id'] !== undefined) this.choose(target.dataset['id']);
      return;
    }
    const move = MOVES[event.key];
    if (!move) return;
    event.preventDefault();
    const enabled = this.enabled();
    if (enabled.length === 0) return;
    const from = enabled.indexOf(target?.dataset['id'] ?? this.current() ?? '');
    const next = enabled[from === -1 ? 0 : move(from, enabled.length)];
    if (next === undefined) return;
    this.activate(next);
    this.item(next)?.focus();
  }

  private onFocusin(event: FocusEvent) {
    const id = (event.target as HTMLElement | null)?.dataset['id'];
    if (id !== undefined && this.enabled().includes(id)) this.activate(id);
  }

  protected override render() {
    const { title, groups } = this.data;
    const active = this.current();
    return html`<div part="menu" class="menu">
      ${title === null ? nothing : html`<p class="title" id="title">${title}</p>`}
      <div
        class="items"
        role="menu"
        aria-labelledby=${title === null ? nothing : 'title'}
        @keydown=${(event: KeyboardEvent) => this.onKeydown(event)}
        @keyup=${(event: KeyboardEvent) => event.key === ' ' && event.preventDefault()}
        @focusin=${(event: FocusEvent) => this.onFocusin(event)}
      >
        ${groups.map(
          (group, index) =>
            html`<div role="group" aria-labelledby="group-${index}">
              <span class="label" id="group-${index}" role="presentation">${group.label}</span>
              ${group.items.map(
                (item) =>
                  html`<button
                    type="button"
                    role="menuitem"
                    class=${item.selected ? 'selected' : ''}
                    data-id=${item.id}
                    tabindex=${item.id === active ? 0 : -1}
                    aria-disabled=${item.disabled ? 'true' : nothing}
                    @click=${() => this.choose(item.id)}
                  >
                    ${item.icon === null
                      ? nothing
                      : html`<cd-icon class="icon" .data=${{ name: item.icon, size: 'sm' }}></cd-icon>`}
                    <span class="text">
                      <b>${item.label}</b>
                      ${item.detail === null ? nothing : html`<span class="detail">${item.detail}</span>`}
                    </span>
                    ${item.selected
                      ? html`<cd-icon class="check" .data=${{ name: 'check', size: 'sm' }}></cd-icon
                          ><span class="visually-hidden">${t('menu.selected')}</span>`
                      : nothing}
                  </button>`,
              )}
            </div>`,
        )}
      </div>
    </div>`;
  }
}
