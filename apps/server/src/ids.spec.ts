import { newId } from './ids.js';

describe('newId', () => {
  it('returns a UUIDv7, which PostgreSQL stores as uuid', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns ids in creation order, each new', () => {
    const ids = Array.from({ length: 50 }, () => newId());

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
