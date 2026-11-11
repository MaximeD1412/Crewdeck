import { css } from 'lit';

/** The look Checkbox and Radio share (DESIGN.md « Forms »): the native input redrawn, its label beside it. */
export const choiceStyles = css`
  label {
    display: flex;
    align-items: center;
    gap: var(--cd-space-3);
    min-height: var(--cd-touch);
    cursor: pointer;
    font: var(--cd-font-body-sm-weight) var(--cd-font-body-sm-size) / var(--cd-font-body-sm-line-height)
      var(--cd-font-body-sm-family), sans-serif;
    color: var(--cd-ink);
  }
  input {
    appearance: none;
    flex: none;
    display: grid;
    place-items: center;
    width: var(--cd-space-5);
    height: var(--cd-space-5);
    margin: 0;
    border: var(--cd-stroke) solid var(--cd-control-border);
    background: var(--cd-side);
    cursor: pointer;
  }
  input:focus-visible {
    outline: var(--cd-stroke) solid var(--cd-accent);
    outline-offset: var(--cd-stroke);
  }
`;
