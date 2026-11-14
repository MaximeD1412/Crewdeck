import { PageConnexion, t } from '@crewdeck/sdk';
import { css, html, nothing } from 'lit';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * `cd-page-connexion`: the welcome, inside the bare Cadre (`design/screens/crewdeck/connexion.html`),
 * the field « Ton adresse e-mail » and the primary « Recevoir un lien » (or
 * Enter in the field), which emit `requestLink` with what is typed; then « ou »
 * and the secondary « Continuer avec GitHub » (`signInWith`), and the help.
 * After a failed attempt, a halt Banner above the field says why. Once the link
 * is sent, a go Banner with the address and « Changer d’adresse »
 * (`changeEmail`) take the field’s place; the address typed comes back with
 * the field.
 */
export class PasserellePageConnexion extends PasserelleElement<typeof PageConnexion> {
  static override styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-4);
        padding-top: var(--cd-space-10);
      }
      h1 {
        font: var(--cd-font-page-title-weight) var(--cd-font-page-title-size) / var(--cd-font-page-title-line-height)
          var(--cd-font-page-title-family), sans-serif;
        letter-spacing: var(--cd-font-page-title-letter-spacing);
        color: var(--cd-ink);
      }
      p {
        color: var(--cd-ink-2);
        font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
          var(--cd-font-body-sm-family), sans-serif;
      }
      .help,
      .or {
        color: var(--cd-muted);
      }
      .or {
        text-align: center;
      }
      cd-button.wide {
        display: flex;
      }
      cd-button.wide::part(button) {
        width: 100%;
      }
    `,
  ];

  protected readonly composant = PageConnexion;

  /** The address typed, kept while the link is out and given back to the field. */
  private email = '';

  private request() {
    if (this.data.busy) return;
    this.emit('requestLink', { email: this.email });
  }

  private onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    this.request();
  }

  private renderForm() {
    const { emailError, busy } = this.data;
    return html`
      <cd-text-field
        part="email"
        .data=${{
          name: 'email',
          label: t('connexion.email.label'),
          value: this.email,
          placeholder: null,
          help: null,
          error: emailError,
          state: null,
          multiline: false,
          maxLength: 254,
        }}
        @input=${(event: Event) => (this.email = (event.currentTarget as HTMLElement & { value: string }).value)}
        @keydown=${this.onKeydown}
      ></cd-text-field>
      <cd-button
        part="request"
        class="request wide"
        .data=${{
          label: t('connexion.email.submit'),
          variant: 'primary',
          size: 'md',
          icon: 'send',
          ...(busy ? { state: 'loading' } : {}),
        }}
        @click=${() => this.request()}
      ></cd-button>
    `;
  }

  private renderSent(sentTo: string) {
    return html`<cd-banner part="sent" .data=${{ tone: 'go', title: t('connexion.sent.title', { email: sentTo }) }}>
      <span part="sent-text">${t('connexion.sent.text')}</span>
      <cd-button
        slot="actions"
        class="change"
        .data=${{ label: t('connexion.sent.change'), variant: 'ghost', size: 'sm' }}
        @click=${() => this.emit('changeEmail', {})}
      ></cd-button>
    </cd-banner>`;
  }

  protected override render() {
    const { error, sentTo } = this.data;
    return html`
      <h1 part="title">${t('connexion.title')}</h1>
      <p part="lead">${t('connexion.lead')}</p>
      ${error ? html`<cd-banner part="error" .data=${{ tone: 'halt', title: t(`connexion.error.${error}`) }}></cd-banner>` : nothing}
      ${sentTo === null ? this.renderForm() : this.renderSent(sentTo)}
      <p part="or" class="or">${t('connexion.or')}</p>
      <cd-button
        part="github"
        class="github wide"
        .data=${{ label: t('connexion.github'), variant: 'secondary', size: 'md', icon: 'github' }}
        @click=${() => this.emit('signInWith', { provider: 'github' })}
      ></cd-button>
      <p part="help" class="help">${t('connexion.help')}</p>
    `;
  }
}
