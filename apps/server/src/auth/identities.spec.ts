import { displayNameOf } from './identities.js';

describe('displayNameOf', () => {
  it('is the local part of the address', () => {
    expect(displayNameOf('ada.lovelace@example.com')).toBe('ada.lovelace');
  });

  it('cuts at the last @, and at 39 characters', () => {
    expect(displayNameOf('"a@b"@example.com')).toBe('"a@b"');
    expect(displayNameOf(`${'x'.repeat(60)}@example.com`)).toBe('x'.repeat(39));
  });
});
