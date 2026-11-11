/**
 * An example's markup for a Composant placed in another's Emplacement: its
 * tag with its data as a JSON `data` attribute, escaped for single quotes,
 * around `content`, the markup of its own Emplacements.
 */
export const placed = (tag: `cd-${string}`, data: unknown, slot?: string, content = ''): string =>
  `<${tag}${slot ? ` slot="${slot}"` : ''} data='${JSON.stringify(data).replaceAll('&', '&amp;').replaceAll("'", '&#39;')}'>${content}</${tag}>`;
