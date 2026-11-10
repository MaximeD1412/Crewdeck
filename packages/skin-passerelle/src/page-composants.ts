import { CD_ACTION, PageComposants, t, type CdActionDetail } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';
import { fillSlots } from './slots.js';

/** The page's URL for a Composant, `?c=<Name>`. */
const hrefOf = (name: string) => `/parametres/composants?c=${encodeURIComponent(name)}`;

/** A plain click of the main button, the one the page handles itself. */
const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** A name as the search compares it: lower case, without its accents. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

type Openable = HTMLElement & { data: Record<string, unknown> };

/**
 * `cd-page-composants`: the library of Composants. The catalogue by category
 * (its rows are links, a plain click emits `select`), then the selected
 * Composant: the preview of each example (the real element, its `data` and
 * Emplacements set from the example, its links and actions kept inside the
 * preview), its description, its data, actions and Emplacements. At 1280 px a
 * search over the names narrows the catalogue; on the phone a Select of every
 * Composant takes the catalogue's place. An example that is open (`open:
 * true`, a Dialog) is previewed closed, beside a button that opens it, and its
 * `close` closes it: a modal would otherwise cover the library.
 */
export class PasserellePageComposants extends PasserelleElement<typeof PageComposants> {
  static override properties = { query: { state: true } };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        padding: var(--cd-space-4) var(--cd-space-4) var(--cd-space-8);
        min-width: 0;
      }
      .lib,
      .catalogue,
      .contract {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .lib,
      .contract {
        gap: var(--cd-space-4);
      }
      .catalogue {
        gap: var(--cd-space-3);
      }
      .text-sm,
      .none {
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
        color: var(--cd-ink-2);
      }
      .none {
        padding: var(--cd-space-3) var(--cd-space-4) var(--cd-space-4);
        color: var(--cd-muted);
      }
      figure {
        margin: 0;
        padding: var(--cd-space-3) var(--cd-space-4) var(--cd-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
        min-width: 0;
      }
      figure + figure {
        border-top: thin solid var(--cd-line);
      }
      figcaption {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      .stage {
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--cd-space-2);
      }
      .stage > :last-child {
        align-self: stretch;
      }
      .side {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-3);
        min-width: 0;
      }
      /* The phone picks a Composant through the Select, the search and the groups are for 1280 px. */
      .search,
      .catalogue {
        display: none;
      }
      /* Focusable: the keyboard scrolls a table wider than the phone. */
      .scroll-x {
        overflow-x: auto;
      }
      .scroll-x:focus-visible {
        outline: var(--cd-stroke) solid var(--cd-accent);
        outline-offset: calc(-1 * var(--cd-stroke));
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      th {
        text-align: left;
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
        color: var(--cd-muted);
        text-transform: uppercase;
        letter-spacing: var(--cd-font-section-label-letter-spacing);
        padding: var(--cd-space-2) var(--cd-space-3);
        border-bottom: thin solid var(--cd-line);
      }
      td {
        padding: var(--cd-space-3);
        border-bottom: thin solid var(--cd-line);
        vertical-align: top;
        color: var(--cd-ink-2);
      }
      tr:last-child td {
        border-bottom: 0;
      }
      td code {
        color: var(--cd-ink);
      }
      /* A name never breaks; a type breaks at its spaces (« IconName | undefined »). */
      td:first-child code {
        white-space: nowrap;
      }
      .identity {
        margin-top: var(--cd-space-2);
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      @media (min-width: 1280px) {
        :host {
          padding: var(--cd-space-8) var(--cd-space-10) var(--cd-space-10);
          gap: var(--cd-space-6);
          max-width: calc(var(--cd-page-max) + var(--cd-space-10) * 2);
        }
        .picker {
          display: none;
        }
        .search {
          display: block;
        }
        .catalogue {
          display: flex;
        }
        .lib {
          display: grid;
          grid-template-columns: var(--cd-sidebar-width) minmax(0, 1fr);
          gap: var(--cd-space-6);
          align-items: start;
        }
        /* Room enough: the name and the type on one line, the description takes the rest. */
        td code {
          white-space: nowrap;
        }
        th:last-child {
          width: 100%;
        }
      }
    `,
  ];

  protected readonly composant = PageComposants;
  declare query: string;

  constructor() {
    super();
    this.query = '';
  }

  private select(event: MouseEvent, name: string) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    this.emit('select', { name });
  }

  /** What happens in a preview stays there: its links lead nowhere, its actions reach no handler. */
  private contain(event: Event) {
    if (event.type === 'click' && event.composedPath().some((node) => node instanceof HTMLAnchorElement)) {
      event.preventDefault();
    } else if (event.type !== 'click') {
      event.stopPropagation();
    }
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (!changed.has('data')) return;
    const { tag, examples } = this.data.selected;
    const stages = this.shadowRoot?.querySelectorAll<HTMLElement>('.stage') ?? [];
    examples.forEach((example, index) => {
      const element = document.createElement(tag) as Openable;
      element.append(...fillSlots(example.slots));
      if (example.data['open'] !== true) {
        element.data = example.data;
        stages[index]?.replaceChildren(element);
        return;
      }
      element.data = { ...example.data, open: false };
      element.addEventListener(CD_ACTION, (event) => {
        if ((event as CustomEvent<CdActionDetail>).detail.action === 'close') element.data = { ...element.data, open: false };
      });
      const opener = document.createElement('cd-button') as Openable;
      opener.data = { label: t('composants.page.openExample', { name: example.name }), variant: 'secondary', size: 'md' };
      opener.addEventListener('click', () => (element.data = { ...element.data, open: true }));
      stages[index]?.replaceChildren(opener, element);
    });
  }

  private renderSide() {
    const { groups, selected } = this.data;
    const options = groups.flatMap((group) =>
      group.composants.map((entry) => ({
        value: entry.name,
        label: `${entry.name} · ${t(`composants.category.${group.category}`)}`,
        disabled: false,
      })),
    );
    return html`<div class="side">
      <cd-select
        class="picker"
        .data=${{ name: 'composant', label: t('composants.page.select'), value: selected.name, options, help: null, state: null }}
        @change=${(event: Event) => this.emit('select', { name: (event.currentTarget as HTMLElement & { value: string }).value })}
      ></cd-select>
      <cd-text-field
        class="search"
        .data=${{
          name: 'search',
          label: t('composants.page.search'),
          value: '',
          placeholder: null,
          help: null,
          error: null,
          state: null,
          multiline: false,
          maxLength: null,
        }}
        @input=${(event: Event) => (this.query = (event.currentTarget as HTMLElement & { value: string }).value)}
      ></cd-text-field>
      ${this.renderCatalogue()}
    </div>`;
  }

  private renderCatalogue() {
    const { selected } = this.data;
    const query = fold(this.query.trim());
    const groups = this.data.groups
      .map((group) => ({ ...group, composants: group.composants.filter((entry) => fold(entry.name).includes(query)) }))
      .filter((group) => group.composants.length > 0);
    return html`<nav class="catalogue" aria-label=${t('composants.page.catalogue')}>
      ${groups.length === 0 ? html`<p class="none">${t('composants.page.noMatch')}</p>` : nothing}
      ${groups.map(
        (group) =>
          html`<cd-card .data=${{ title: t(`composants.category.${group.category}`), flush: true }}>
            ${group.composants.map((entry) => {
              const open = entry.name === selected.name;
              return html`<cd-list-row
                .data=${{
                  title: entry.name,
                  href: hrefOf(entry.name),
                  ...(open ? { icon: 'layers', tone: 'accent' } : {}),
                }}
                @click=${(event: MouseEvent) => this.select(event, entry.name)}
              >
                ${open
                  ? html`<cd-status-badge
                      slot="trailing"
                      .data=${{ tone: 'accent', label: t('composants.page.badge.open') }}
                    ></cd-status-badge>`
                  : nothing}
              </cd-list-row>`;
            })}
          </cd-card>`,
      )}
    </nav>`;
  }

  private renderContract() {
    const { selected } = this.data;
    const none = (key: 'composants.page.noData' | 'composants.page.noActions' | 'composants.page.noSlots') =>
      html`<p class="none">${t(key)}</p>`;
    return html`<div class="contract">
      <cd-card .data=${{ title: t('composants.page.preview'), label: t('composants.page.preview'), flush: true }}>
        <div class="previews" @click=${this.contain} @cd-action=${this.contain}>
          ${selected.examples.map(
            (example) => html`<figure>
              <figcaption>${example.name}</figcaption>
              <div class="stage"></div>
            </figure>`,
          )}
        </div>
      </cd-card>
      <cd-card .data=${{ title: selected.name }}>
        <p class="text-sm">${selected.description}</p>
        <p class="identity"><code>${selected.tag}</code> · ${t('composants.page.version', { version: selected.version })}</p>
      </cd-card>
      <cd-card .data=${{ title: t('composants.page.data'), label: t('composants.page.data'), flush: true }}>
        ${selected.fields.length === 0
          ? none('composants.page.noData')
          : html`<div class="scroll-x" tabindex="0" role="group" aria-label=${t('composants.page.data')}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">${t('composants.page.column.name')}</th>
                    <th scope="col">${t('composants.page.column.type')}</th>
                    <th scope="col">${t('composants.page.column.description')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${selected.fields.map(
                    (field) => html`<tr>
                      <td><code>${field.name}</code></td>
                      <td><code>${field.type}</code></td>
                      <td>${field.description}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>`}
      </cd-card>
      <cd-card .data=${{ title: t('composants.page.actions'), label: t('composants.page.actions'), flush: true }}>
        ${selected.actions.length === 0
          ? none('composants.page.noActions')
          : selected.actions.map(
              (action) => html`<cd-list-row .data=${{ title: `${action.name}()`, meta: action.description }}>
                <cd-status-badge
                  slot="trailing"
                  .data=${action.sensitive
                    ? { tone: 'accent', label: t('composants.page.badge.sensitive') }
                    : { tone: 'neutral', label: t('composants.page.badge.free') }}
                ></cd-status-badge>
              </cd-list-row>`,
            )}
      </cd-card>
      <cd-card .data=${{ title: t('composants.page.slots'), label: t('composants.page.slots'), flush: true }}>
        ${selected.slots.length === 0
          ? none('composants.page.noSlots')
          : selected.slots.map((slot) => html`<cd-list-row .data=${{ title: slot.name, meta: slot.description }}></cd-list-row>`)}
      </cd-card>
    </div>`;
  }

  protected override render() {
    const { selected } = this.data;
    return html`
      <cd-page-header
        .data=${{ title: t('composants.page.title'), count: selected.name, back: { label: t('composants.page.back'), href: '/parametres' } }}
      ></cd-page-header>
      <div class="lib">${this.renderSide()} ${this.renderContract()}</div>
    `;
  }
}
