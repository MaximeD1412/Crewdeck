/**
 * What the form Composants' declarations share (ADR 0006, « Consequences »):
 * they declare no action of the core. They dispatch the native `input` and
 * `change` events (`composed: true`) and take part in their `<form>` through
 * `ElementInternals`; the page Composant that holds the form reads its
 * `FormData` and emits its own domain action, so « data in, actions out »
 * stays at the page's level.
 */
export const FORM_CONTROL_NOTE =
  'Il n’émet aucune action : il envoie les évènements natifs input et change et prend part à son formulaire, dont la page lit le FormData pour émettre sa propre action.';
