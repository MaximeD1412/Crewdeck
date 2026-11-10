import { PageComposants, t } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';
import { fillSlots } from './slots.js';

/** The page's URL for a Composant, `?c=<Name>`. */
const hrefOf = (name: string) => `/parametres/composants?c=${encodeURIComponent(name)}`;

/** A plain click of the main button, the one the page handles itself. */
const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * `cd-page-composants`: the library of Composants. The catalogue by category
 * (its rows are links, a plain click emits `select`), then the selected
 * Composant: the preview of each example (the real element, its `data` and
 * Emplacements set from the example, its links and actions kept inside the
 * preview), its description, its data, actions and Emplacements.
 */
export class PasserellePageComposants extends PasserelleElement<typeof PageComposants> {
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
      th:first-child,
      td:first-child {
        padding-left: var(--cd-space-4);
      }
      th:last-child,
      td:last-child {
        padding-right: var(--cd-space-4);
      }
      tr:last-child td {
        border-bottom: 0;
      }
      td code {
        color: var(--cd-ink);
        white-space: nowrap;
      }
      @media (min-width: 1280px) {
        :host {
          padding: var(--cd-space-8) var(--cd-space-10) var(--cd-space-10);
          gap: var(--cd-space-6);
          max-width: calc(var(--cd-page-max) + var(--cd-space-10) * 2);
        }
        .lib {
          display: grid;
          grid-template-columns: var(--cd-sidebar-width) minmax(0, 1fr);
          gap: var(--cd-space-6);
          align-items: start;
        }
      }
    `,
  ];

  protected readonly composant = PageComposants;

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
      const element = document.createElement(tag) as HTMLElement & { data: unknown };
      element.data = example.data;
      element.append(...fillSlots(example.slots));
      stages[index]?.replaceChildren(element);
    });
  }

  private renderCatalogue() {
    const { groups, selected } = this.data;
    return html`<nav class="catalogue" aria-label=${t('composants.page.catalogue')}>
      ${groups.map(
        (group) =>
          html`<cd-card .data=${{ title: t(`composants.category.${group.category}`), count: group.composants.length, flush: true }}>
            ${group.composants.map((entry) => {
              const open = entry.name === selected.name;
              return html`<cd-list-row
                .data=${{
                  title: entry.name,
                  meta: t('composants.page.version', { version: entry.version }),
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
      </cd-card>
      <cd-card .data=${{ title: t('composants.page.data'), label: t('composants.page.data'), count: selected.fields.length, flush: true }}>
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
      <cd-card .data=${{ title: t('composants.page.actions'), label: t('composants.page.actions'), count: selected.actions.length, flush: true }}>
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
      <cd-card .data=${{ title: t('composants.page.slots'), label: t('composants.page.slots'), count: selected.slots.length, flush: true }}>
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
      <div class="lib">${this.renderCatalogue()} ${this.renderContract()}</div>
    `;
  }
}
