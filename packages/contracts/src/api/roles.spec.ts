import { zRoleId } from './roles.js';

describe('zRoleId', () => {
  it('takes a default Rôle or a Rôle of the Pilote’s, r- then 8 characters', () => {
    for (const id of ['idea', 'design', 'code', 'review', 'r-a1b2c3d4']) expect(zRoleId.safeParse(id).success, id).toBe(true);
  });

  it('refuses anything else', () => {
    for (const id of ['tester', 'r-a1b2c3', 'r-a1b2c3d4e', 'r-A1B2C3D4', 'R-a1b2c3d4', '']) expect(zRoleId.safeParse(id).success, id).toBe(false);
  });
});
