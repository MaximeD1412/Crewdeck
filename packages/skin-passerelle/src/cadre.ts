import { BREAKPOINT_PX, Cadre, t, type CadreStatus } from '@crewdeck/sdk';
import { css, html, LitElement, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** The tone and the label of each state of the Runner (`design/components.js`, `RUNNER`). */
const STATUS: Readonly<Record<CadreStatus, { tone: 'go' | 'halt' | 'caution'; label: () => string }>> = {
  online: { tone: 'go', label: () => t('cadre.status.online') },
  offline: { tone: 'halt', label: () => t('cadre.status.offline') },
  resync: { tone: 'caution', label: () => t('cadre.status.resync') },
};

/** The Emplacements given by name; any other child is the page. */
const NAMED = new Set(['menu', 'banner', 'panel', 'overlay']);

/** A `cd-menu-item`'s data: its property once upgraded, its JSON attribute before. */
const itemData = (item: Element): { id?: string; primary?: boolean } | undefined => {
  const data = (item as Element & { data?: { id?: string; primary?: boolean } }).data;
  if (data) return data;
  try {
    return JSON.parse(item.getAttribute('data') ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * `cd-cadre`: the whole page. Its shadow root assigns its children by hand
 * (`slotAssignment: 'manual'`): the one `menu` Emplacement goes to the
 * sidebar at 1280 (the four first entries, a rule, the others), and at 390
 * to the tab bar (the `primary` entries) and to the rows of the « Plus »
 * sheet (the others), one slot per row so that the hairlines are drawn here.
 * The sheet is a modal `<dialog>`: Escape and « Fermer » close it, and the
 * focus goes back to « Plus ».
 */
export class PasserelleCadre extends PasserelleElement<typeof Cadre> {
  static override shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, slotAssignment: 'manual' };

  static override styles = [
    sharedStyles,
    css`
      :host {
        background: var(--cd-ground);
      }
      .shell {
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
      }
      slot {
        display: contents;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: var(--cd-space-3);
        color: var(--cd-ink);
        font: var(--cd-font-brand-weight) var(--cd-font-brand-size) / var(--cd-font-brand-line-height)
          var(--cd-font-brand-family), sans-serif;
        letter-spacing: var(--cd-font-brand-letter-spacing);
        text-transform: uppercase;
      }
      .mark {
        width: var(--cd-icon-box);
        height: var(--cd-icon-box);
        border-radius: var(--cd-radius);
        background: var(--cd-accent);
        color: var(--cd-accent-ink);
        display: grid;
        place-items: center;
      }
      .dot {
        flex: none;
        width: var(--cd-dot);
        height: var(--cd-dot);
        border-radius: var(--cd-radius-full);
        background: var(--cd-muted);
      }
      .dot.go {
        background: var(--cd-go);
      }
      .dot.halt {
        background: var(--cd-halt);
      }
      .dot.caution {
        background: var(--cd-caution);
      }
      .dot.live {
        background: var(--cd-accent);
        box-shadow: 0 0 0 var(--cd-space-1) var(--cd-accent-soft);
      }

      /* 390: the top bar, the page, the tab bar */
      .side {
        display: none;
      }
      .top {
        position: sticky;
        top: 0;
        z-index: 3;
        height: var(--cd-header-height);
        display: flex;
        align-items: center;
        gap: var(--cd-space-3);
        padding: 0 var(--cd-space-4);
        background: var(--cd-side);
        border-bottom: thin solid var(--cd-line);
      }
      .top .status {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: var(--cd-space-2);
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
        color: var(--cd-muted);
      }
      .top .status.halt {
        color: var(--cd-halt);
      }
      .top .status.caution {
        color: var(--cd-caution);
      }
      .body {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .banners {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
        padding: var(--cd-space-3) var(--cd-space-4) 0;
      }
      main {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        min-width: 0;
        padding: var(--cd-space-4) var(--cd-space-4) var(--cd-space-8);
      }
      .tabs {
        position: sticky;
        bottom: 0;
        z-index: 3;
        height: var(--cd-tab-bar);
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        background: var(--cd-side);
        border-top: thin solid var(--cd-line);
      }
      .more {
        position: relative;
        min-height: var(--cd-touch);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--cd-space-1);
        color: var(--cd-muted);
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
      }
      .more:focus-visible {
        outline-offset: calc(var(--cd-stroke) * -1);
      }
      .more.current {
        color: var(--cd-accent-text);
      }
      .more.current::before {
        content: '';
        position: absolute;
        top: 0;
        left: 25%;
        right: 25%;
        height: var(--cd-stroke);
        background: var(--cd-accent);
      }

      /* 390: the panel covers the screen */
      .with-panel aside {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 100dvh;
        background: var(--cd-panel);
      }
      .with-panel .top,
      .with-panel .body,
      .with-panel .tabs {
        display: none;
      }

      .overlay {
        position: fixed;
        inset: 0;
        z-index: 10;
        background: var(--cd-scrim);
        display: flex;
        align-items: flex-end;
        justify-content: center;
      }
      .overlay ::slotted(*) {
        width: 100%;
      }

      /* The « Plus » sheet */
      dialog {
        margin: auto 0 0;
        width: 100%;
        max-width: 100%;
        max-height: 100dvh;
        padding: 0;
        overflow: auto;
        color: var(--cd-ink);
        background: var(--cd-raised);
        border: thin solid var(--cd-line-strong);
        border-bottom: 0;
        border-radius: var(--cd-radius-lg) var(--cd-radius-lg) 0 0;
      }
      dialog::backdrop {
        background: var(--cd-scrim);
      }
      .head {
        display: flex;
        align-items: center;
        gap: var(--cd-space-3);
        padding: var(--cd-space-4) var(--cd-space-4) var(--cd-space-2);
      }
      h2 {
        flex: 1;
        font: var(--cd-font-page-title-weight) var(--cd-font-brand-size) / var(--cd-font-title-line-height)
          var(--cd-font-page-title-family), sans-serif;
        color: var(--cd-ink);
      }
      .sheet-body {
        padding: var(--cd-space-2) var(--cd-space-4) var(--cd-space-4);
      }
      .rows {
        background: var(--cd-panel);
        border: thin solid var(--cd-line);
        border-radius: var(--cd-radius-lg);
        overflow: hidden;
      }
      .entry + .entry {
        border-top: thin solid var(--cd-line);
      }

      /* Bare: the brand above the page */
      .bare-top {
        display: flex;
        align-items: center;
        height: var(--cd-header-height);
        padding: var(--cd-space-4);
      }
      .bare main {
        width: 100%;
        max-width: var(--cd-dialog-width);
        margin: 0 auto;
        padding-top: var(--cd-space-6);
      }

      @media (min-width: 1280px) {
        .shell {
          display: grid;
          grid-template-columns: var(--cd-sidebar-width) minmax(0, 1fr);
        }
        .shell.with-panel {
          grid-template-columns: var(--cd-sidebar-width) minmax(0, 1fr) var(--cd-panel-width);
        }
        .shell.bare {
          display: flex;
        }
        .side {
          position: sticky;
          top: 0;
          height: 100vh;
          display: flex;
          flex-direction: column;
          gap: var(--cd-space-6);
          padding: var(--cd-space-6) var(--cd-space-4);
          background: var(--cd-side);
          border-right: thin solid var(--cd-line);
          overflow-y: auto;
        }
        .side .brand {
          padding: 0 var(--cd-space-2);
        }
        nav.list {
          display: flex;
          flex-direction: column;
          gap: var(--cd-space-1);
        }
        hr {
          width: 100%;
          border: 0;
          border-top: thin solid var(--cd-line);
          margin: var(--cd-space-3) 0;
        }
        .foot {
          margin-top: auto;
          display: flex;
          flex-direction: column;
          gap: var(--cd-space-3);
        }
        .foot .status {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 0 var(--cd-space-2);
          align-items: center;
          padding: var(--cd-space-3);
          border: thin solid var(--cd-line);
          border-radius: var(--cd-radius-lg);
          font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
            var(--cd-font-caption-family), sans-serif;
          color: var(--cd-muted);
        }
        .foot .status .label {
          font: var(--cd-font-label-weight) var(--cd-font-label-size) / var(--cd-font-label-line-height)
            var(--cd-font-label-family), sans-serif;
          color: var(--cd-ink);
        }
        .foot .status .detail {
          grid-column: 2;
        }
        .foot .status.halt {
          border-color: var(--cd-halt);
          background: var(--cd-halt-soft);
        }
        .foot .status.halt .label {
          color: var(--cd-halt);
        }
        .foot .status.caution {
          border-color: var(--cd-caution);
          background: var(--cd-caution-soft);
        }
        .foot .status.caution .label {
          color: var(--cd-caution);
        }
        .live {
          display: flex;
          align-items: center;
          gap: var(--cd-space-2);
          padding: 0 var(--cd-space-3);
          font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
            var(--cd-font-caption-family), sans-serif;
          color: var(--cd-muted);
        }
        .pilot {
          display: flex;
          align-items: center;
          gap: var(--cd-space-2);
          min-height: var(--cd-touch);
          padding: var(--cd-space-2) var(--cd-space-3);
          border-radius: var(--cd-radius);
          color: var(--cd-ink-2);
          font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
            var(--cd-font-meta-family), monospace;
          text-align: left;
        }
        .pilot:hover {
          background: var(--cd-raised);
          color: var(--cd-ink);
        }
        .avatar {
          flex: none;
          width: var(--cd-icon-box);
          height: var(--cd-icon-box);
          border-radius: var(--cd-radius-full);
          overflow: hidden;
          background: var(--cd-sunk);
          color: var(--cd-ink-2);
          display: inline-grid;
          place-items: center;
          font: 600 var(--cd-font-caption-size) / 1 var(--cd-font-body-family), sans-serif;
        }
        .avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .top,
        .tabs,
        dialog {
          display: none;
        }
        .banners {
          padding: var(--cd-space-6) var(--cd-space-10) 0;
          max-width: calc(var(--cd-page-max) + var(--cd-space-10) * 2);
        }
        main {
          gap: var(--cd-space-6);
          padding: var(--cd-space-8) var(--cd-space-10) var(--cd-space-10);
          max-width: calc(var(--cd-page-max) + var(--cd-space-10) * 2);
        }
        .banners:not([hidden]) + main {
          padding-top: var(--cd-space-6);
        }
        .with-panel .body {
          display: flex;
        }
        .with-panel aside {
          position: sticky;
          top: 0;
          height: 100vh;
          min-height: 0;
          overflow: auto;
          border-left: thin solid var(--cd-line);
          box-shadow: 0 0 var(--cd-space-6) var(--cd-shadow);
        }
        .overlay {
          align-items: center;
        }
        .overlay ::slotted(*) {
          width: auto;
        }
        .bare-top {
          padding: var(--cd-space-6) var(--cd-space-10);
        }
        .bare main {
          padding-top: var(--cd-space-10);
        }
      }
    `,
  ];

  protected readonly composant = Cadre;

  private readonly wide = matchMedia(`(min-width: ${BREAKPOINT_PX}px)`);
  private readonly children$ = new MutationObserver((records) => {
    if (records.some((record) => record.target === this || record.target.parentNode === this)) this.requestUpdate();
  });

  /** What the children hold, read before each render. */
  private layout = { menu: [] as Element[], banner: false, panel: false, overlay: false };

  private readonly onWide = () => {
    if (this.wide.matches) this.sheet?.close();
    this.requestUpdate();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.children$.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['slot', 'data'] });
    this.wide.addEventListener('change', this.onWide);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.children$.disconnect();
    this.wide.removeEventListener('change', this.onWide);
  }

  private named(name: string): Element[] {
    return [...this.children].filter((child) => child.getAttribute('slot') === name);
  }

  protected override willUpdate(): void {
    this.layout = {
      menu: this.named('menu'),
      banner: this.named('banner').length > 0,
      panel: this.named('panel').length > 0,
      overlay: this.named('overlay').length > 0,
    };
  }

  private get primary(): Element[] {
    return this.layout.menu.filter((item) => itemData(item)?.primary);
  }

  private get others(): Element[] {
    return this.layout.menu.filter((item) => !itemData(item)?.primary);
  }

  private get sheet(): HTMLDialogElement | null {
    return this.renderRoot.querySelector('dialog');
  }

  private slotAt(selector: string): HTMLSlotElement | null {
    return this.renderRoot.querySelector<HTMLSlotElement>(`slot[data-for="${selector}"]`);
  }

  /** Gives each child its slot: the page, the named Emplacements, the menu where the width puts it. */
  protected override updated(): void {
    const page = [...this.childNodes].filter((node) =>
      node instanceof Element ? !NAMED.has(node.getAttribute('slot') ?? '') : node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim(),
    ) as (Element | Text)[];
    const slots = [...this.renderRoot.querySelectorAll<HTMLSlotElement>('slot')];
    for (const slot of slots) slot.assign();
    this.slotAt('page')?.assign(...page);
    for (const name of ['banner', 'panel', 'overlay']) this.slotAt(name)?.assign(...this.named(name));
    if (this.data.variant === 'bare') return;
    if (this.wide.matches) {
      this.slotAt('side-primary')?.assign(...this.primary);
      this.slotAt('side-others')?.assign(...this.others);
    } else {
      this.slotAt('tabs')?.assign(...this.primary);
      this.others.forEach((item, index) => this.slotAt(`sheet-${index}`)?.assign(item));
    }
  }

  private openSheet = () => this.sheet?.showModal();

  private closeSheet = () => this.sheet?.close();

  /** Back to « Plus » whichever way the sheet closed. */
  private onSheetClose = () => {
    if (!this.wide.matches) this.renderRoot.querySelector<HTMLButtonElement>('.more')?.focus();
  };

  /** Following an entry, or a click on the scrim, closes the sheet. */
  private onSheetClick = (event: MouseEvent) => {
    if (event.target === this.sheet || event.composedPath().some((node) => node instanceof HTMLAnchorElement)) this.closeSheet();
  };

  private brand() {
    return html`<div class="brand"><span class="mark"><cd-icon .data=${{ name: 'mark', size: 'sm' }}></cd-icon></span>${t('cadre.brand')}</div>`;
  }

  protected override render() {
    const { variant, current, screenLabel, status, statusDetail, live, pilot } = this.data;
    const { banner, panel, overlay } = this.layout;
    const page = html`<main aria-label=${screenLabel}><slot data-for="page"></slot></main>`;
    const overlayFrame = html`<div class="overlay" ?hidden=${!overlay}><slot data-for="overlay"></slot></div>`;

    if (variant === 'bare') {
      return html`<div class="shell bare">
        <header class="bare-top">${this.brand()}</header>
        ${page} ${overlayFrame}
      </div>`;
    }

    const { tone, label } = STATUS[status];
    const isLive = live && status === 'online';
    const others = this.others;
    const moreCurrent = others.some((item) => itemData(item)?.id === current);
    return html`<div class="shell ${panel ? 'with-panel' : ''}">
      <div class="side">
        ${this.brand()}
        <nav class="list" aria-label=${t('cadre.nav')}>
          <slot data-for="side-primary"></slot>
          <hr />
          <slot data-for="side-others"></slot>
        </nav>
        <div class="foot">
          <div class="status ${tone}">
            <span class="dot ${tone}" aria-hidden="true"></span>
            <b class="label">${label()}</b>
            ${statusDetail ? html`<span class="detail">${statusDetail}</span>` : nothing}
          </div>
          ${isLive ? html`<div class="live"><span class="dot live" aria-hidden="true"></span>${t('cadre.live')}</div>` : nothing}
          ${pilot
            ? html`<button class="pilot" type="button" @click=${() => this.emit('openPilot', {})}>
                <span class="avatar" aria-hidden="true"
                  >${pilot.avatarUrl ? html`<img src=${pilot.avatarUrl} alt="" />` : pilot.login.slice(0, 2).toUpperCase()}</span
                >
                <span class="login">${pilot.login}</span>
              </button>`
            : nothing}
        </div>
      </div>
      <header class="top">
        ${this.brand()}
        <span class="status ${isLive ? '' : tone}"
          ><span class="dot ${isLive ? 'live' : tone}" aria-hidden="true"></span>${isLive ? t('cadre.live') : label()}</span
        >
      </header>
      <div class="body">
        <div class="banners" ?hidden=${!banner}><slot data-for="banner"></slot></div>
        ${page}
      </div>
      <aside aria-label=${t('cadre.panel')} ?hidden=${!panel}><slot data-for="panel"></slot></aside>
      <nav class="tabs" aria-label=${t('cadre.nav')}>
        <slot data-for="tabs"></slot>
        <button class="more ${moreCurrent ? 'current' : ''}" type="button" aria-haspopup="dialog" @click=${this.openSheet}>
          <cd-icon .data=${{ name: 'more', size: 'md' }}></cd-icon><span class="label">${t('cadre.more')}</span>
        </button>
      </nav>
      <dialog aria-labelledby="sheet-title" @close=${this.onSheetClose} @click=${this.onSheetClick}>
        <div class="head">
          <h2 id="sheet-title">${t('cadre.more')}</h2>
          <cd-icon-button .data=${{ icon: 'x', label: t('cadre.close') }} @click=${this.closeSheet}></cd-icon-button>
        </div>
        <div class="sheet-body">
          <div class="rows">${others.map((_, index) => html`<div class="entry"><slot data-for="sheet-${index}"></slot></div>`)}</div>
        </div>
      </dialog>
      ${overlayFrame}
    </div>`;
  }
}
