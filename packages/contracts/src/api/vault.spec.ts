import { eventPayloadSchema, STATE_SLICES, zRevokeDevice, zVault, zVaultItems, zVaultRotation } from '../index.js';

const ID = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01';
const KEY = 'A'.repeat(43);
const ITEM_KEY = 'B'.repeat(80);
const WRAP = { holderType: 'device', holderId: ID, enc: KEY, ciphertext: 'C'.repeat(64), tag: KEY };

describe('the vault (E2E-4)', () => {
  it('is a slice of the state and the payload of vault.upserted', () => {
    expect(STATE_SLICES.vault.parse({ version: 1, rotationPending: true })).toEqual({ version: 1, rotationPending: true });
    expect(eventPayloadSchema('vault.upserted')?.safeParse({ version: 0, rotationPending: false }).success).toBe(true);
    expect(STATE_SLICES.vault.safeParse({ version: -1, rotationPending: false }).success).toBe(false);
  });

  it('lists its holders with their public keys, and the item keys page by page', () => {
    expect(zVault.parse({ version: 2, rotationPending: true, holders: [{ type: 'runner', id: ID, publicKey: KEY }], seq: 12 })).toMatchObject({ seq: 12 });
    expect(zVault.safeParse({ version: 2, rotationPending: true, holders: [{ type: 'server', id: ID, publicKey: KEY }], seq: 12 }).success).toBe(false);
    const item = { itemType: 'idea.text', itemId: ID, aad: `${ID}:text`, wrappedKey: ITEM_KEY };
    expect(zVaultItems.parse({ items: [item], nextCursor: null })).toEqual({ items: [item], nextCursor: null });
    expect(zVaultItems.safeParse({ items: [{ ...item, wrappedKey: KEY }], nextCursor: null }).success).toBe(false);
    expect(zVaultItems.safeParse({ items: [{ ...item, itemType: 'Idea' }], nextCursor: null }).success).toBe(false);
  });

  it('rotates to the next version only, with at least one wrap', () => {
    const rotation = { fromVersion: 1, toVersion: 2, wraps: [WRAP], items: [{ itemType: 'idea.text', itemId: ID, wrappedKey: ITEM_KEY }], seq: 3 };
    expect(zVaultRotation.parse(rotation)).toEqual(rotation);
    expect(zVaultRotation.safeParse({ ...rotation, toVersion: 3 }).success).toBe(false);
    expect(zVaultRotation.safeParse({ ...rotation, wraps: [] }).success).toBe(false);
    expect(zVaultRotation.safeParse({ ...rotation, seq: undefined }).success).toBe(false);
  });

  it('revokes an Appareil with the seq of its last change', () => {
    expect(zRevokeDevice.parse({ seq: '4' })).toEqual({ seq: 4 });
    expect(zRevokeDevice.safeParse({}).success).toBe(false);
  });
});
