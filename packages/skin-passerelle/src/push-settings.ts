import { PushSettings, t, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing, type TemplateResult } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Data = ComposantData<typeof PushSettings>;
type Subscription = Data['subscriptions'][number];

/**
 * `cd-push-settings` (`design/screens/crewdeck/parametres.html`, the card
 * « Notifications »): a Card holding the Toggle « Notifications push » of the
 * account, a ListRow per browser that receives them with a ghost « Retirer »,
 * then this browser's own way: « Activer sur cet appareil » and, under it,
 * why it failed; nothing once it is subscribed; the help to add Crewdeck to
 * the home screen where it cannot receive any. The Toggle's `change` stays
 * inside: `toggle` says it.
 */
export class PasserellePushSettings extends PasserelleElement<typeof PushSettings> {
  static override styles = [
    sharedStyles,
    css`
      .device {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--cd-space-2);
      }
      .install,
      .error {
        margin: 0;
        font: var(--cd-font-caption-weight) var(--cd-font-caption-size) / var(--cd-font-caption-line-height)
          var(--cd-font-caption-family), sans-serif;
        color: var(--cd-muted);
      }
      .error {
        color: var(--cd-halt);
      }
    `,
  ];

  protected readonly composant = PushSettings;

  private stop(event: Event) {
    event.stopPropagation();
  }

  private onToggle(event: Event) {
    event.stopPropagation();
    this.emit('toggle', { push: (event.currentTarget as HTMLElement & { checked: boolean }).checked });
  }

  private subscribe() {
    if (!this.data.busy) this.emit('subscribe', {});
  }

  private row(subscription: Subscription): TemplateResult {
    return html`<cd-list-row .data=${{ title: subscription.label, meta: subscription.meta, icon: 'bell' }}>
      <cd-button
        slot="trailing"
        class="remove"
        .data=${{ label: t('settings.notifications.remove'), variant: 'ghost', size: 'sm' }}
        @click=${() => this.emit('remove', { id: subscription.id })}
      ></cd-button>
    </cd-list-row>`;
  }

  private device(): TemplateResult | typeof nothing {
    const { device, busy, error } = this.data;
    if (device === 'subscribed') return nothing;
    if (device === 'unavailable') return html`<p class="install">${t('settings.notifications.install')}</p>`;
    return html`<div class="device">
      <cd-button
        class="subscribe"
        .data=${{
          label: t('settings.notifications.subscribe'),
          variant: 'secondary',
          size: 'sm',
          icon: 'bell',
          ...(busy ? { state: 'loading' as const } : {}),
        }}
        @click=${this.subscribe}
      ></cd-button>
      ${error ? html`<p class="error" role="alert">${error}</p>` : nothing}
    </div>`;
  }

  protected override render() {
    const { push, subscriptions } = this.data;
    return html`<cd-card .data=${{ title: t('settings.notifications.title'), label: t('settings.notifications.label') }} @cd-action=${this.stop}>
      <cd-toggle
        .data=${{
          name: 'push',
          label: t('settings.notifications.push.label'),
          checked: push,
          help: t('settings.notifications.push.help'),
          state: null,
        }}
        @change=${this.onToggle}
      ></cd-toggle>
      ${subscriptions.map((subscription) => this.row(subscription))} ${this.device()}
    </cd-card>`;
  }
}
