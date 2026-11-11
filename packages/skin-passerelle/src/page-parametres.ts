import { PageParametres, SETTINGS_SECTIONS, t, type SettingsSection } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** Each section's anchor, the French of its page's URL (`/parametres#compte`). */
const ANCHORS: Readonly<Record<SettingsSection, string>> = {
  roles: 'roles',
  notifications: 'notifications',
  schedules: 'planifications',
  'optional-steps': 'etapes',
  projects: 'projets',
  account: 'compte',
  modders: 'moddeurs',
};

const DESKTOP = '(min-width: 1280px)';

/** A plain click of the main button, the one the page handles itself. */
const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** A form control of a section: a Toggle or a Checkbox gives `checked`, the others `value`. */
type Control = Element & { data?: { name?: unknown }; checked?: unknown; value?: unknown };

/**
 * `cd-page-parametres`: the page's header, the nav of the filled sections
 * (pills that scroll sideways on the phone, a sticky column at 1280 px), then
 * each section's Emplacement. On the phone only the current section shows,
 * the one its link opens; at 1280 px all of them, a link scrolling to its
 * own. A control's `change` in a section emits `change`.
 */
export class PasserellePageParametres extends PasserelleElement<typeof PageParametres> {
  static override properties = { filled: { state: true }, current: { state: true } };

  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        min-width: 0;
      }
      .settings,
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        min-width: 0;
      }
      nav {
        display: flex;
        gap: var(--cd-space-2);
        overflow-x: auto;
        margin: 0 calc(var(--cd-space-4) * -1);
        padding: 0 var(--cd-space-4);
        scrollbar-width: none;
      }
      nav a {
        display: inline-flex;
        align-items: center;
        min-height: var(--cd-control-sm);
        padding: 0 var(--cd-space-3);
        border: thin solid var(--cd-line-strong);
        border-radius: var(--cd-radius);
        color: var(--cd-ink-2);
        white-space: nowrap;
        font: var(--cd-font-label-weight) var(--cd-font-body-sm-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
      }
      nav a[aria-current] {
        color: var(--cd-accent-text);
        border-color: var(--cd-accent);
        background: var(--cd-accent-soft);
      }
      section:not(.current) {
        display: none;
      }
      @media (min-width: 1280px) {
        .settings {
          display: grid;
          grid-template-columns: var(--cd-capture-w) minmax(0, 1fr);
          gap: var(--cd-space-8);
          align-items: start;
        }
        nav {
          flex-direction: column;
          margin: 0;
          padding: 0;
          position: sticky;
          top: var(--cd-space-8);
          gap: var(--cd-space-1);
        }
        nav a {
          border: 0;
          min-height: var(--cd-control);
        }
        nav a[aria-current] {
          box-shadow: inset var(--cd-stroke) 0 0 var(--cd-accent);
        }
        .body {
          gap: var(--cd-space-6);
        }
        section:not(.current) {
          display: block;
        }
      }
    `,
  ];

  protected readonly composant = PageParametres;

  /** The sections whose Emplacement holds something, in their order. */
  declare private filled: readonly SettingsSection[];
  /** The section its link last opened. */
  declare private current: SettingsSection | null;

  constructor() {
    super();
    this.filled = [];
    this.current = null;
    this.addEventListener('change', (event) => this.onChange(event));
  }

  /** The section shown: the one opened, while it is filled, else the first. */
  private get shownSection(): SettingsSection | null {
    return this.current && this.filled.includes(this.current) ? this.current : (this.filled[0] ?? null);
  }

  // Read before the first render, from the light DOM: no second render at boot.
  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (!this.hasUpdated) this.readFilled();
  }

  /** The Emplacements holding an element: a named Emplacement only takes elements. */
  private readFilled() {
    const filled = SETTINGS_SECTIONS.filter((section) => [...this.children].some((child) => child.slot === section));
    if (filled.join() !== this.filled.join()) this.filled = filled;
  }

  private onChange(event: Event) {
    const control = event.target as Control;
    if (control === this || typeof control.data?.name !== 'string' || control.data.name === '') return;
    const value = typeof control.checked === 'boolean' && !('value' in control) ? control.checked : control.value;
    if (typeof value !== 'string' && typeof value !== 'boolean') return;
    this.emit('change', { name: control.data.name, value });
  }

  private open(event: MouseEvent, section: SettingsSection) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    this.current = section;
    if (matchMedia(DESKTOP).matches) this.shadowRoot?.getElementById(ANCHORS[section])?.scrollIntoView({ block: 'start' });
  }

  protected override render() {
    const shown = this.shownSection;
    return html`
      <cd-page-header .data=${{ title: t('settings.title'), count: t('settings.subtitle') }}></cd-page-header>
      <div class="settings">
        <nav aria-label=${t('settings.nav')} ?hidden=${this.filled.length === 0}>
          ${this.filled.map(
            (section) =>
              html`<a href="#${ANCHORS[section]}" aria-current=${section === shown ? 'true' : nothing} @click=${(event: MouseEvent) => this.open(event, section)}
                >${t(`settings.section.${section}`)}</a
              >`,
          )}
        </nav>
        <div class="body">
          ${SETTINGS_SECTIONS.map(
            (section) =>
              html`<section
                id=${ANCHORS[section]}
                class=${section === shown ? 'current' : ''}
                ?hidden=${!this.filled.includes(section)}
              >
                <slot name=${section} @slotchange=${() => this.readFilled()}></slot>
              </section>`,
          )}
        </div>
      </div>
    `;
  }
}
