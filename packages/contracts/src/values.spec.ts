import { z } from 'zod';
import { zCursorPage, zCursorQuery, zDay, zEurCents, zId, zInstant, zSeq, zUsdMicros } from './index.js';

describe('zId', () => {
  it('accepts a UUIDv7', () => {
    expect(zId.parse('019a6f3e-7c2a-7b1e-9f00-1234567890ab')).toBe('019a6f3e-7c2a-7b1e-9f00-1234567890ab');
  });

  it('rejects a UUIDv4', () => {
    expect(zId.safeParse('3b241101-e2bb-4255-8caf-4136c566a962').success).toBe(false);
  });

  it('rejects what is not a UUID', () => {
    expect(zId.safeParse('42').success).toBe(false);
  });
});

describe('zInstant', () => {
  it('accepts an ISO 8601 instant in UTC and keeps it a string', () => {
    expect(zInstant.parse('2026-11-10T08:30:00.000Z')).toBe('2026-11-10T08:30:00.000Z');
    expect(zInstant.parse('2026-11-10T08:30:00Z')).toBe('2026-11-10T08:30:00Z');
  });

  it('rejects an offset other than Z', () => {
    expect(zInstant.safeParse('2026-11-10T09:30:00+01:00').success).toBe(false);
  });

  it('rejects a day without a time', () => {
    expect(zInstant.safeParse('2026-11-10').success).toBe(false);
  });
});

describe('zDay', () => {
  it('accepts YYYY-MM-DD and keeps it a string', () => {
    expect(zDay.parse('2026-02-28')).toBe('2026-02-28');
  });

  it('rejects a day that does not exist', () => {
    expect(zDay.safeParse('2026-02-30').success).toBe(false);
  });

  it('rejects an instant', () => {
    expect(zDay.safeParse('2026-02-28T00:00:00Z').success).toBe(false);
  });
});

describe.each([
  ['zUsdMicros', zUsdMicros],
  ['zEurCents', zEurCents],
  ['zSeq', zSeq],
])('%s', (_name, schema) => {
  it('accepts zero and a positive integer', () => {
    expect(schema.parse(0)).toBe(0);
    expect(schema.parse(1_800_000)).toBe(1_800_000);
  });

  it('rejects -1 and 1.5', () => {
    expect(schema.safeParse(-1).success).toBe(false);
    expect(schema.safeParse(1.5).success).toBe(false);
  });

  it('rejects a number written as a string', () => {
    expect(schema.safeParse('42').success).toBe(false);
  });
});

describe('zCursorPage', () => {
  const zPage = zCursorPage(z.object({ id: zId }));

  it('accepts items and a next cursor, or null at the end', () => {
    const items = [{ id: '019a6f3e-7c2a-7b1e-9f00-1234567890ab' }];
    expect(zPage.parse({ items, nextCursor: 'abc' })).toEqual({ items, nextCursor: 'abc' });
    expect(zPage.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
  });

  it('rejects a page without nextCursor and an invalid item', () => {
    expect(zPage.safeParse({ items: [] }).success).toBe(false);
    expect(zPage.safeParse({ items: [{ id: '42' }], nextCursor: null }).success).toBe(false);
  });
});

describe('zCursorQuery', () => {
  it('defaults the limit to 50, the cursor absent', () => {
    expect(zCursorQuery.parse({})).toEqual({ limit: 50 });
  });

  it('reads the limit of a query string', () => {
    expect(zCursorQuery.parse({ cursor: 'abc', limit: '20' })).toEqual({ cursor: 'abc', limit: 20 });
  });

  it('rejects a limit outside 1..100', () => {
    expect(zCursorQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(zCursorQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(zCursorQuery.safeParse({ limit: '2.5' }).success).toBe(false);
  });
});
