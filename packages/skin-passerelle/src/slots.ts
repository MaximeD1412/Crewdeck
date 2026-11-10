/**
 * An example's Emplacements as nodes to append to its Composant: each slot's
 * HTML parsed in a `<template>`, its top-level elements given `slot="<name>"`
 * (none for `default`), its loose text wrapped in a `span`. The library's
 * preview and the Skin's tests place the examples through it.
 */
export const fillSlots = (slots: Readonly<Record<string, string>> | undefined): Node[] =>
  Object.entries(slots ?? {}).flatMap(([name, markup]) => {
    const template = document.createElement('template');
    template.innerHTML = markup;
    return [...template.content.childNodes].flatMap((node): Node[] => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.textContent?.trim()) return [];
        const span = document.createElement('span');
        span.append(node);
        node = span;
      }
      if (!(node instanceof Element)) return [];
      if (name !== 'default') node.setAttribute('slot', name);
      return [document.importNode(node, true)];
    });
  });
