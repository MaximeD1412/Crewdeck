import { css } from 'lit';

/**
 * What the Passerelle's rows share (`design/DESIGN.md`, « Rows and cards »):
 * their state carried by a left rail, a tinted icon box and a badge, never a
 * coloured surface; a hairline between two rows; title, meta (mono), context.
 *
 * A row that opens has its `.open` control (a button, or a link) stretched
 * over the whole row by its `::after`, which also carries its focus ring;
 * `.over` lifts what stays pressable on its own (the page's buttons) above
 * it. No interactive element is ever inside another.
 */
export const rowStyles = css`
  .row {
    position: relative;
    display: grid;
    gap: 0 var(--cd-space-3);
    align-items: start;
    padding: var(--cd-space-3) var(--cd-space-4) var(--cd-space-3) 0;
    color: var(--cd-ink);
  }
  :host(:not(:first-child)) .row {
    border-top: thin solid var(--cd-line);
  }
  .row:hover,
  .row.selected {
    background: var(--cd-raised);
  }
  .rail {
    align-self: stretch;
    width: var(--cd-rail);
    border-radius: 0 var(--cd-radius-sm) var(--cd-radius-sm) 0;
    background: transparent;
  }
  .halt .rail {
    background: var(--cd-halt);
  }
  .caution .rail {
    background: var(--cd-caution);
  }
  .accent .rail {
    background: var(--cd-accent);
  }
  .go .rail {
    background: var(--cd-go);
  }
  .neutral .rail {
    background: var(--cd-line-strong);
  }
  .icon {
    width: var(--cd-icon-box);
    height: var(--cd-icon-box);
    border-radius: var(--cd-radius);
    display: grid;
    place-items: center;
    background: var(--cd-sunk);
    color: var(--cd-ink-2);
  }
  .halt .icon {
    background: var(--cd-halt-soft);
    color: var(--cd-halt);
  }
  .caution .icon {
    background: var(--cd-caution-soft);
    color: var(--cd-caution);
  }
  .accent .icon {
    background: var(--cd-accent-soft);
    color: var(--cd-accent-text);
  }
  .go .icon {
    background: var(--cd-go-soft);
    color: var(--cd-go);
  }
  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--cd-space-1);
  }
  .title-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--cd-space-1) var(--cd-space-2);
    min-width: 0;
  }
  .title {
    font: var(--cd-font-title-weight) var(--cd-font-label-size) / var(--cd-font-title-line-height)
      var(--cd-font-title-family), sans-serif;
    color: var(--cd-ink);
    text-align: left;
    overflow-wrap: anywhere;
  }
  .meta,
  .facts,
  .number {
    font: var(--cd-font-meta-weight) var(--cd-font-meta-size) / var(--cd-font-meta-line-height)
      var(--cd-font-meta-family), monospace;
    color: var(--cd-muted);
  }
  .meta {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .context {
    font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
      var(--cd-font-body-sm-family), sans-serif;
    color: var(--cd-ink-2);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--cd-space-1) var(--cd-space-3);
  }
  .facts span {
    white-space: nowrap;
  }
  .aside {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--cd-space-2);
    align-self: center;
  }
  .open::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .open:focus-visible {
    outline: none;
  }
  .open:focus-visible::after {
    outline: var(--cd-stroke) solid var(--cd-accent);
    outline-offset: calc(var(--cd-stroke) * -1);
  }
  a.open,
  a.open:hover {
    color: var(--cd-ink);
  }
  .over {
    position: relative;
    z-index: 1;
  }
`;
