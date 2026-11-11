import { formatHour, Message, t } from '@crewdeck/sdk';
import { css, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import MarkdownIt from 'markdown-it';
import { PasserelleElement, sharedStyles } from './base.js';

/**
 * The agent's Markdown: never its HTML (`html: false`, the text comes from a
 * model), bare URLs linked, every link opened apart without the opener.
 * markdown-it's own `validateLink` drops `javascript:` and its kin.
 */
const markdown = new MarkdownIt({ html: false, linkify: true });
const renderToken = markdown.renderer.renderToken.bind(markdown.renderer);
markdown.renderer.rules['link_open'] = (tokens, index, options) => {
  const token = tokens[index];
  token?.attrSet('target', '_blank');
  token?.attrSet('rel', 'noopener noreferrer');
  return renderToken(tokens, index, options);
};

/** The agent's text as HTML, safe to put in the page. */
export const renderMarkdown = (text: string): string => markdown.render(text);

/** `cd-message`: the agent's text as Markdown, the Pilote's as typed, in a bubble on the right; its author for screen readers, its time. */
export class PasserelleMessage extends PasserelleElement<typeof Message> {
  static override styles = [
    sharedStyles,
    css`
      .message {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-1);
        color: var(--cd-ink-2);
      }
      .pilote {
        margin-left: auto;
        width: fit-content;
        max-width: 85%;
        background: var(--cd-accent-soft);
        color: var(--cd-ink);
        padding: var(--cd-space-2) var(--cd-space-3);
        border-radius: var(--cd-radius-lg);
      }
      .pilote .text {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .agent .text {
        display: flex;
        flex-direction: column;
        gap: var(--cd-space-2);
        overflow-wrap: anywhere;
      }
      .text :where(p, ul, ol, pre, blockquote, h1, h2, h3, h4, h5, h6) {
        margin: 0;
      }
      .text :where(h1, h2, h3, h4, h5, h6) {
        font: var(--cd-font-title-weight) var(--cd-font-title-size) / var(--cd-font-title-line-height)
          var(--cd-font-title-family), sans-serif;
        color: var(--cd-ink);
      }
      .text :where(ul, ol) {
        padding-left: var(--cd-space-5);
      }
      .text strong {
        color: var(--cd-ink);
      }
      .text a {
        text-decoration: underline;
      }
      .text code {
        background: var(--cd-sunk);
        padding: 0 var(--cd-space-1);
        border-radius: var(--cd-radius-sm);
      }
      .text pre {
        background: var(--cd-side);
        border: thin solid var(--cd-line);
        border-radius: var(--cd-radius);
        padding: var(--cd-space-3);
        overflow-x: auto;
      }
      .text pre code {
        background: none;
        padding: 0;
      }
      .text blockquote {
        border-left: var(--cd-stroke) solid var(--cd-line-strong);
        padding-left: var(--cd-space-3);
      }
      time {
        align-self: flex-end;
        color: var(--cd-muted);
        font: var(--cd-font-meta-weight) var(--cd-font-caption-size) / var(--cd-font-meta-line-height)
          var(--cd-font-meta-family), monospace;
      }
      .agent time {
        align-self: flex-start;
      }
    `,
  ];

  protected readonly composant = Message;

  protected override render() {
    const { from, text, at } = this.data;
    return html`<div part="message" class="message ${from}">
      <span class="visually-hidden">${t(from === 'agent' ? 'message.from.agent' : 'message.from.pilote')}</span>
      ${from === 'agent'
        ? html`<div class="text">${unsafeHTML(renderMarkdown(text))}</div>`
        : html`<p class="text">${text}</p>`}
      <time datetime=${at}>${formatHour(at)}</time>
    </div>`;
  }
}
