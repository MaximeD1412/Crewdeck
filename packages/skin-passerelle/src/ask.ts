import { css } from 'lit';

/**
 * What a Question and a PermissionRequest share: a framed card that stands
 * out of the log, its kicker in capitals with its icon, its title, its
 * buttons in a row.
 */
export const askStyles = css`
  .ask {
    display: flex;
    flex-direction: column;
    gap: var(--cd-space-3);
    padding: var(--cd-space-4);
    border: thin solid var(--cd-accent);
    border-radius: var(--cd-radius-lg);
    background: var(--cd-raised);
  }
  .kicker {
    display: flex;
    align-items: center;
    gap: var(--cd-space-2);
    color: var(--cd-accent-text);
    font: var(--cd-font-section-label-weight) var(--cd-font-section-label-size) / var(--cd-font-section-label-line-height)
      var(--cd-font-section-label-family), sans-serif;
    letter-spacing: var(--cd-font-section-label-letter-spacing);
    text-transform: uppercase;
  }
  h3 {
    margin: 0;
    color: var(--cd-ink);
    font: var(--cd-font-title-weight) var(--cd-font-title-size) / var(--cd-font-title-line-height)
      var(--cd-font-title-family), sans-serif;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--cd-space-2);
  }
`;
