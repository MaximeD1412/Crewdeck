/**
 * Whether two `data` hold the same values: plain objects and arrays compared
 * field by field, anything else by identity (`Object.is`).
 */
export const sameData = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((value, i) => sameData(value, (b as unknown[])[i]));
  const plain = (value: object) => [Object.prototype, null].includes(Object.getPrototypeOf(value));
  if (!plain(a) || !plain(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  );
};
