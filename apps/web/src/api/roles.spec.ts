import { DEFAULT_ACCOUNT_SETTINGS } from '@crewdeck/contracts';
import type { z } from 'zod';
import type { Client } from './client.js';
import { createRole, removeRole } from './roles.js';

const SETTINGS = {
  ...DEFAULT_ACCOUNT_SETTINGS,
  timeZone: 'Europe/Paris',
  roles: { ...DEFAULT_ACCOUNT_SETTINGS.roles, 'r-k3v9q2m7': { engine: 'codex', model: 'gpt-5.5' } },
  customRoles: [{ id: 'r-k3v9q2m7', name: 'Revue Codex', createdAt: '2026-11-11T08:30:00.000Z' }],
};

const recording = () => {
  const calls: unknown[] = [];
  const client = {
    command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
      calls.push({ method, path, body });
      return schema?.parse(SETTINGS);
    }) as Client['command'],
  };
  return { calls, client };
};

describe('createRole', () => {
  it('posts the new Rôle and answers the settings', async () => {
    const { calls, client } = recording();
    await expect(createRole(client, { name: 'Revue Codex', engine: 'codex', model: 'gpt-5.5' })).resolves.toEqual(SETTINGS);
    expect(calls).toEqual([{ method: 'POST', path: '/api/roles', body: { name: 'Revue Codex', engine: 'codex', model: 'gpt-5.5' } }]);
  });
});

describe('removeRole', () => {
  it('deletes the Rôle and answers the settings', async () => {
    const { calls, client } = recording();
    await expect(removeRole(client, 'r-k3v9q2m7')).resolves.toEqual(SETTINGS);
    expect(calls).toEqual([{ method: 'DELETE', path: '/api/roles/r-k3v9q2m7', body: {} }]);
  });
});
