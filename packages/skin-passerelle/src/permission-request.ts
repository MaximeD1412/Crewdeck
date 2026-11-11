import { PermissionRequest, t } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { askStyles } from './ask.js';
import { PasserelleElement, sharedStyles } from './base.js';

/** `cd-permission-request`: « {tool} demande ta permission », the command in a mono block, then its three buttons. */
export class PasserellePermissionRequest extends PasserelleElement<typeof PermissionRequest> {
  static override styles = [
    sharedStyles,
    askStyles,
    css`
      .ask {
        border-color: var(--cd-caution);
      }
      h3 {
        display: flex;
        align-items: center;
        gap: var(--cd-space-2);
      }
      h3 cd-icon {
        color: var(--cd-caution);
      }
      pre {
        margin: 0;
        padding: var(--cd-space-3);
        background: var(--cd-side);
        border-radius: var(--cd-radius);
        color: var(--cd-ink);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    `,
  ];

  protected readonly composant = PermissionRequest;

  protected override render() {
    const { id, tool, command } = this.data;
    return html`<div part="request" class="ask" role="group" aria-labelledby="title">
      <h3 id="title"><cd-icon .data=${{ name: 'shield', size: 'sm' }}></cd-icon>${t('permissionRequest.title', { tool })}</h3>
      <pre part="command"><code>${command}</code></pre>
      <div class="buttons">
        <cd-button
          class="allow"
          .data=${{ label: t('permissionRequest.allow'), variant: 'primary', size: 'sm' }}
          @click=${() => this.emit('allow', { id })}
        ></cd-button>
        <cd-button
          class="allow-for-session"
          .data=${{ label: t('permissionRequest.allowForSession'), variant: 'secondary', size: 'sm' }}
          @click=${() => this.emit('allowForSession', { id })}
        ></cd-button>
        <cd-button
          class="deny"
          .data=${{ label: t('permissionRequest.deny'), variant: 'ghost', size: 'sm' }}
          @click=${() => this.emit('deny', { id })}
        ></cd-button>
      </div>
    </div>`;
  }
}
