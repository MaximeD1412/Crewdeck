import { AccountIdentities, t, type ComposantData } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

type Identity = ComposantData<typeof AccountIdentities>['identities'][number];

/** The icon of an Identité's row, aligned with GitHub's: the set has no mark for an address nor Google. */
const PROVIDER_ICONS = { email: 'inbox', google: 'user', github: 'github' } as const satisfies Record<Identity['provider'], string>;

/**
 * `cd-account-identities`: the Card « Connexion » of the Paramètres
 * (CORE-11), one `cd-list-row` per Identité (« E-mail », « Google »,
 * « GitHub », its address or login), then GitHub: not linked, the row
 * « pas relié » with the secondary « Relier GitHub »; its tokens gone,
 * « à reconnecter » with « Reconnecter GitHub »; both emit `linkGitHub`.
 * After a failed link, a halt Banner above the Card says why.
 */
export class PasserelleAccountIdentities extends PasserelleElement<typeof AccountIdentities> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-3);
      }
    `,
  ];

  protected readonly composant = AccountIdentities;

  private link(label: string) {
    return html`<cd-button
      slot="trailing"
      class="link"
      .data=${{ label, variant: 'secondary', size: 'sm', icon: 'github' }}
      @click=${() => this.emit('linkGitHub', {})}
    ></cd-button>`;
  }

  private row(identity: Identity) {
    const title = t(`parametres.identities.provider.${identity.provider}`);
    if (identity.provider !== 'github') return html`<cd-list-row .data=${{ title, meta: identity.label, icon: PROVIDER_ICONS[identity.provider] }}></cd-list-row>`;
    if (!identity.reconnect) return html`<cd-list-row .data=${{ title, meta: identity.label, icon: 'github' }}></cd-list-row>`;
    return html`<cd-list-row .data=${{ title, meta: t('parametres.identities.github.reconnect.meta'), icon: 'github', tone: 'caution' }}
      >${this.link(t('parametres.identities.github.reconnect'))}</cd-list-row
    >`;
  }

  protected override render() {
    const { identities, error } = this.data;
    const linked = identities.some((identity) => identity.provider === 'github');
    return html`
      ${error ? html`<cd-banner part="error" .data=${{ tone: 'halt', title: t(`parametres.identities.error.${error}`) }}></cd-banner>` : nothing}
      <cd-card part="card" .data=${{ title: t('parametres.identities.title'), label: t('parametres.identities.label'), flush: true }}>
        ${identities.map((identity) => this.row(identity))}
        ${linked
          ? nothing
          : html`<cd-list-row .data=${{ title: t('parametres.identities.provider.github'), meta: t('parametres.identities.github.none'), icon: 'github' }}
              >${this.link(t('parametres.identities.github.link'))}</cd-list-row
            >`}
      </cd-card>
    `;
  }
}
