import { zId } from '@crewdeck/contracts';
import { uuidv7 } from './ids.js';

describe('uuidv7', () => {
  it('puts the instant first, then the version 7 and the variant, as RFC 9562', () => {
    const id = uuidv7(Date.parse('2026-11-16T10:00:00.000Z'), new Uint8Array(10).fill(0xff));
    expect(id).toBe(`${Date.parse('2026-11-16T10:00:00.000Z').toString(16).padStart(12, '0').replace(/^(.{8})(.{4})$/, '$1-$2')}-7fff-bfff-ffffffffffff`);
    expect(zId.safeParse(id).success).toBe(true);
  });

  it('draws a new one each time, ordered by instant', () => {
    const [first, second, later] = [uuidv7(1000), uuidv7(1000), uuidv7(2000)];
    expect(new Set([first, second, later]).size).toBe(3);
    expect(later > first).toBe(true);
  });
});
