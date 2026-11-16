import { zCustomRoleId } from '@crewdeck/contracts';
import { DEFAULT_ROLE_NAMES, newCustomRoleId, roleNameKey } from './roles.js';

describe('newCustomRoleId', () => {
  it('draws r- then 8 characters of [a-z0-9], a new one each time', () => {
    const ids = Array.from({ length: 200 }, newCustomRoleId);
    for (const id of ids) expect(zCustomRoleId.safeParse(id).success, id).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('roleNameKey', () => {
  it('makes the same key of two names that differ by case or spaces around', () => {
    expect(roleNameKey('  Revue Codex ')).toBe(roleNameKey('revue codex'));
    expect(roleNameKey('REVIEW')).toBe(roleNameKey(DEFAULT_ROLE_NAMES.review));
    expect(roleNameKey('Idée')).toBe('idée');
  });

  it('keeps apart two names that differ inside', () => {
    expect(roleNameKey('Revue  Codex')).not.toBe(roleNameKey('Revue Codex'));
  });
});
