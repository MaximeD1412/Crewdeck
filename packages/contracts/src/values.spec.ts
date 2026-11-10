import { zId } from './index.js';

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
