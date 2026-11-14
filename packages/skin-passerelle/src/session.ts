import { Session, t, type ComposantData, type MessageKey } from '@crewdeck/sdk';
import { css, html, type PropertyValues } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type State = ComposantData<typeof Session>['state'];

const STATES: Readonly<Record<State, { tone: 'go' | 'caution' | 'neutral' | 'halt'; label: MessageKey }>> = {
  active: { tone: 'go', label: 'session.state.active' },
  waiting: { tone: 'caution', label: 'session.state.waiting' },
  stopped: { tone: 'neutral', label: 'session.state.stopped' },
  interrupted: { tone: 'caution', label: 'session.state.interrupted' },
  failed: { tone: 'halt', label: 'session.state.failed' },
};

/** How close to the bottom, in px, still counts as « at the bottom ». */
const BOTTOM_SLACK = 24;

/**
 * `cd-session`: its head (the back arrow on a phone, its state, « Arrêter »
 * or « Reprendre » (or its `resumeLabel` and `resumeIcon`, « Relancer » for a
 * failed Commande), « Agrandir » and « Fermer » at 1280 px), its messages in a
 * polite log that keeps to the bottom while the Pilote has not scrolled up,
 * then its Composer. Given a height, the log scrolls; without one, it grows.
 */
export class PasserelleSession extends PasserelleElement<typeof Session> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--cd-panel);
        border: thin solid var(--cd-line);
        border-radius: var(--cd-radius-lg);
        overflow: hidden;
      }
      header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cd-space-2);
        padding: var(--cd-space-2) var(--cd-space-3);
        border-bottom: thin solid var(--cd-line);
        background: var(--cd-panel);
        flex: none;
      }
      /* The meta wraps rather than cut the Projet and the Moteur, as the title does on a phone; there, the actions go under them when they lack room. */
      .titles {
        flex: 1 1 12rem;
        min-width: 0;
      }
      h2 {
        display: flex;
        align-items: center;
        gap: var(--cd-space-2);
        font: var(--cd-font-title-weight) var(--cd-font-title-size) / var(--cd-font-title-line-height)
          var(--cd-font-title-family), sans-serif;
      }
      .meta {
        font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
        color: var(--cd-muted);
      }
      .waiting .state {
        color: var(--cd-caution);
      }
      .actions {
        display: flex;
        align-items: center;
        gap: var(--cd-space-1);
        flex: none;
        margin-left: auto;
      }
      .wide {
        display: none;
      }
      @media (min-width: 1280px) {
        header {
          flex-wrap: nowrap;
        }
        h2 span {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .back {
          display: none;
        }
        .wide {
          display: block;
        }
      }
      [role='log'] {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .stream {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-3);
        padding: var(--cd-space-4);
      }
      .composer {
        flex: none;
      }
    `,
  ];

  protected readonly composant = Session;

  /** Whether the log follows what comes: until the Pilote scrolls up, and again once back at the bottom. */
  private pinned = true;
  /** Where the log last scrolled itself to. */
  private followedTo = 0;
  private readonly resizes = new ResizeObserver(() => this.follow());

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizes.disconnect();
  }

  private get log(): HTMLElement | null | undefined {
    return this.shadowRoot?.querySelector<HTMLElement>('[role=log]');
  }

  private follow() {
    const log = this.log;
    if (!log || !this.pinned) return;
    log.scrollTop = log.scrollHeight;
    this.followedTo = log.scrollTop;
  }

  /**
   * A scroll up unpins the log; only one back to the bottom pins it again.
   * While pinned, the log's own scrolls do not unpin it: content that grew
   * since it followed is not the Pilote scrolling up. Once unpinned, past
   * where it last followed is not the bottom: what came meanwhile is still
   * to read.
   */
  private onScroll() {
    const log = this.log;
    if (!log) return;
    const atBottom = log.scrollHeight - log.clientHeight - log.scrollTop <= BOTTOM_SLACK;
    this.pinned = atBottom || (this.pinned && log.scrollTop >= this.followedTo);
  }

  private observe() {
    // The stream grows with each message, and with a message's text as it streams; the log, with the panel.
    for (const target of [this.shadowRoot?.querySelector('.stream'), this.log]) if (target) this.resizes.observe(target);
  }

  protected override firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    this.observe();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.observe();
  }

  private resume() {
    if (this.data.resumeDisabledReason === null) this.emit('resume', {});
  }

  protected override render() {
    const { title, meta, state, resumeLabel, resumeIcon, resumeDisabledReason } = this.data;
    const { tone, label } = STATES[state];
    const running = state === 'active' || state === 'waiting';
    return html`<header part="head" class=${state}>
        <cd-icon-button
          class="back"
          .data=${{ icon: 'arrow-left', label: t('session.back') }}
          @click=${() => this.emit('close', {})}
        ></cd-icon-button>
        <div class="titles">
          <h2>
            <cd-status-dot .data=${{ tone, pulse: state === 'active', label: t(label) }}></cd-status-dot>
            <span>${title}</span>
          </h2>
          <p class="meta"><span class="state">${t(label)}</span> · ${meta}</p>
        </div>
        <div class="actions">
          ${running
            ? html`<cd-button
                class="stop"
                .data=${{ label: t('session.stop'), variant: 'secondary', size: 'sm', icon: 'stop' }}
                @click=${() => this.emit('stop', {})}
              ></cd-button>`
            : html`<cd-button
                class="resume"
                .data=${{
                  label: resumeLabel ?? t('session.resume'),
                  variant: 'secondary',
                  size: 'sm',
                  icon: resumeIcon ?? 'play',
                  ...(resumeDisabledReason === null ? {} : { state: 'disabled', disabledReason: resumeDisabledReason }),
                }}
                @click=${() => this.resume()}
              ></cd-button>`}
          <cd-icon-button
            class="expand wide"
            .data=${{ icon: 'expand', label: t('session.expand') }}
            @click=${() => this.emit('expand', {})}
          ></cd-icon-button>
          <cd-icon-button
            class="close wide"
            .data=${{ icon: 'x', label: t('session.close') }}
            @click=${() => this.emit('close', {})}
          ></cd-icon-button>
        </div>
      </header>
      <div
        part="log"
        role="log"
        aria-live="polite"
        aria-label=${t('session.log')}
        tabindex="0"
        @scroll=${() => this.onScroll()}
      >
        <div class="stream"><slot @slotchange=${() => this.follow()}></slot></div>
      </div>
      <div part="composer" class="composer"><slot name="composer"></slot></div>`;
  }
}
