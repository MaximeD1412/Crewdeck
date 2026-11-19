import { decodeMigrationCursor, encodeMigrationCursor } from './migration-cursor.js';

describe('the cursor of the migrations of Source', () => {
  const cursor = { createdAt: new Date('2026-11-19T08:00:00.000Z'), id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01' };

  it('gives back what it encoded', () => {
    expect(decodeMigrationCursor(encodeMigrationCursor(cursor))).toEqual(cursor);
  });

  it('refuses anything it did not encode', () => {
    for (const text of ['', 'abc', Buffer.from('2026-11-19|not-an-id').toString('base64url'), Buffer.from(`nope|${cursor.id}`).toString('base64url'), Buffer.from(`2026-11-19T08:00:00.000Z|${cursor.id}|x`).toString('base64url')]) {
      expect(decodeMigrationCursor(text), text).toBeUndefined();
    }
  });
});
