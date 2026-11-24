import { type AnyComposant, PageParametres, SETTINGS_SECTIONS, t, type SettingsSection } from '@crewdeck/sdk';
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/** Each section's anchor, the French of its page's URL (`/parametres#compte`). */
const ANCHORS: Readonly<Record<SettingsSection, string>> = {
  roles: 'roles',
  notifications: 'notifications',
  devices: 'appareils',
  schedules: 'planifications',
  projects: 'projets',
  'process-templates': 'modeles',
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
 * What the pages of Paramètres share, the account's and a Projet's: their
 * header, then the nav of the filled sections (pills that scroll sideways on
 * the phone, a sticky column at 1280 px), then each section's Emplacement. On
 * the phone only the current section shows, the one its link opens; at
 * 1280 px all of them, a link scrolling to its own. A control's `change` in a
 * section is handed to `changed`.
 */
export abstract class PasserelleSettingsPage<C extends AnyComposant, S extends string> extends PasserelleElement<C> {
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
      .body,
      section {
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
        gap: var(--cd-space-2);
        min-height: var(--cd-control-sm);
        padding: 0 var(--cd-space-3);
        border: thin solid var(--cd-line-strong);
        border-radius: var(--cd-radius);
        color: var(--cd-ink-2);
        white-space: nowrap;
        font: var(--cd-font-label-weight) var(--cd-font-body-sm-size) / var(--cd-font-label-line-height)
          var(--cd-font-label-family), sans-serif;
      }
      nav .n {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-accent-text);
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
        :host {
          gap: var(--cd-space-6);
        }
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
          justify-content: space-between;
        }
        nav a[aria-current] {
          box-shadow: inset var(--cd-stroke) 0 0 var(--cd-accent);
        }
        .body,
        section {
          gap: var(--cd-space-6);
        }
        /* A section holds one Card or several (« Compte »: « Connexion », then the time zone), spaced as the sections. */
        section:not(.current) {
          display: flex;
        }
      }
    `,
  ];

  /** The page's sections, in their order: each an Emplacement. */
  protected abstract readonly sections: readonly S[];
  /** Each section's anchor, in French. */
  protected abstract readonly anchors: Readonly<Record<S, string>>;
  /** The nav's accessible name. */
  protected abstract navLabel(): string;
  /** What the page shows above its sections: its header, a Banner. */
  protected abstract head(): TemplateResult;
  /** The link of `section` in the nav. */
  protected abstract link(section: S): unknown;
  /** A control of a section changed. */
  protected abstract changed(name: string, value: string | boolean): void;

  /** The sections whose Emplacement holds something, in their order. */
  declare private filled: readonly S[];
  /** The section its link last opened. */
  declare private current: S | null;

  constructor() {
    super();
    this.filled = [];
    this.current = null;
    this.addEventListener('change', (event) => this.onChange(event));
  }

  /** The section shown: the one opened, while it is filled, else the first. */
  private get shownSection(): S | null {
    return this.current && this.filled.includes(this.current) ? this.current : (this.filled[0] ?? null);
  }

  // Read before the first render, from the light DOM: no second render at boot.
  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (!this.hasUpdated) this.readFilled();
  }

  /** The Emplacements holding an element: a named Emplacement only takes elements. */
  private readFilled() {
    const filled = this.sections.filter((section) => [...this.children].some((child) => child.slot === section));
    if (filled.join() !== this.filled.join()) this.filled = filled;
  }

  private onChange(event: Event) {
    const control = event.target as Control;
    if (control === this || typeof control.data?.name !== 'string' || control.data.name === '') return;
    const value = typeof control.checked === 'boolean' && !('value' in control) ? control.checked : control.value;
    if (typeof value !== 'string' && typeof value !== 'boolean') return;
    this.changed(control.data.name, value);
  }

  private open(event: MouseEvent, section: S) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    this.current = section;
    if (matchMedia(DESKTOP).matches) this.shadowRoot?.getElementById(this.anchors[section])?.scrollIntoView({ block: 'start' });
  }

  protected override render() {
    const shown = this.shownSection;
    return html`
      ${this.head()}
      <div class="settings">
        <nav aria-label=${this.navLabel()} ?hidden=${this.filled.length === 0}>
          ${this.filled.map(
            (section) =>
              html`<a href="#${this.anchors[section]}" aria-current=${section === shown ? 'true' : nothing} @click=${(event: MouseEvent) => this.open(event, section)}
                >${this.link(section)}</a
              >`,
          )}
        </nav>
        <div class="body">
          ${this.sections.map(
            (section) =>
              html`<section
                id=${this.anchors[section]}
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

/**
 * `cd-page-parametres`: the account's Paramètres, « Paramètres » and its
 * subtitle in the header, then its sections. A control's `change` in a
 * section emits `change`.
 */
export class PasserellePageParametres extends PasserelleSettingsPage<typeof PageParametres, SettingsSection> {
  protected readonly composant = PageParametres;
  protected readonly sections = SETTINGS_SECTIONS;
  protected readonly anchors = ANCHORS;

  protected navLabel(): string {
    return t('settings.nav');
  }

  protected head(): TemplateResult {
    return html`<cd-page-header .data=${{ title: t('settings.title'), count: t('settings.subtitle') }}></cd-page-header>`;
  }

  protected link(section: SettingsSection): unknown {
    return t(`settings.section.${section}`);
  }

  protected changed(name: string, value: string | boolean): void {
    this.emit('change', { name, value });
  }
}
