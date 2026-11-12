/** The page's aria-live region: what the core says to a screen reader without moving the focus. */
export interface Announcer {
  /** The visually hidden `role="status"` region, placed by the Cadre's shell. */
  readonly element: HTMLElement;
  /** Says `text`; the same text twice is said twice. */
  announce(text: string): void;
}

export const createAnnouncer = (): Announcer => {
  const element = document.createElement('div');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.dataset.crewdeckAnnouncer = '';
  // Visually hidden, still read: the Cadre gives it no box of its own.
  Object.assign(element.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  });
  return {
    element,
    // A new text node each time: screen readers say a replaced node again.
    announce: (text) => element.replaceChildren(document.createTextNode(text)),
  };
};

/** The page's announcer: the shell mounts it in the Cadre, the dispatcher speaks through it. */
export const announcer = createAnnouncer();
