/**
 * A UUIDv7 (RFC 9562): the instant in milliseconds on 48 bits, then 74
 * random bits. The page draws an Idée's id itself, to seal its text under it
 * before the server has the row (IDEE-1).
 */
export const uuidv7 = (now: number = Date.now(), random: Uint8Array = crypto.getRandomValues(new Uint8Array(10))): string => {
  const bytes = new Uint8Array(16);
  let instant = now;
  for (let index = 5; index >= 0; index--) {
    bytes[index] = instant % 256;
    instant = Math.floor(instant / 256);
  }
  bytes[6] = 0x70 | ((random[0] ?? 0) & 0x0f);
  bytes[7] = random[1] ?? 0;
  bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f);
  bytes.set(random.subarray(3, 10), 9);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
