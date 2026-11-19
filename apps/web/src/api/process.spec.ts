import { PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, type ProjectProcess } from '@crewdeck/contracts';
import type { z } from 'zod';
import type { Client } from './client.js';
import { activateProcess, getProcess, saveDraft } from './process.js';

const PROJECT = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a80';
const VIEW: ProjectProcess = {
  id: PROJECT,
  active: { number: 1, definition: PROCESS_CREWDECK, sealed: null, activatedAt: '2026-11-15T08:00:00.000Z', activatedBy: 'creation', templateName: PROCESS_CREWDECK_NAME },
  draft: null,
  sources: { ticket: { source: 'github', since: '2026-11-15T08:00:00.000Z' }, code: { source: 'github', since: '2026-11-15T08:00:00.000Z' } },
  running: [],
};

describe('getProcess', () => {
  it('reads the Projet’s Process, typed by the contracts', async () => {
    const paths: string[] = [];
    const client = {
      query: (async (path: string, schema: z.ZodType) => {
        paths.push(path);
        return schema.parse(VIEW);
      }) as Client['query'],
    };

    await expect(getProcess(client, PROJECT)).resolves.toEqual(VIEW);
    expect(paths).toEqual([`/api/projects/${PROJECT}/process`]);
  });
});

describe('saveDraft', () => {
  it('puts the whole draft with its revision and its version, and answers the view', async () => {
    const calls: unknown[] = [];
    const saved: ProjectProcess = { ...VIEW, draft: { definition: PROCESS_CREWDECK, sealed: null, revision: 1, baseVersion: 1, updatedAt: '2026-11-15T09:00:00.000Z' } };
    const client = {
      command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
        calls.push({ method, path, body });
        return schema?.parse(saved);
      }) as Client['command'],
    };
    const input = { definition: PROCESS_CREWDECK, sealed: null, revision: 0, baseVersion: 1 };

    await expect(saveDraft(client, PROJECT, input)).resolves.toEqual(saved);
    expect(calls).toEqual([{ method: 'PUT', path: `/api/projects/${PROJECT}/process/draft`, body: input }]);
  });
});

describe('activateProcess', () => {
  it('posts the draft’s revision with the seq of the dialog, and answers the view', async () => {
    const calls: unknown[] = [];
    const activated: ProjectProcess = { ...VIEW, active: { ...VIEW.active!, number: 2, activatedBy: 'pilot', templateName: null } };
    const client = {
      command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
        calls.push({ method, path, body });
        return schema?.parse(activated);
      }) as Client['command'],
    };

    await expect(activateProcess(client, PROJECT, { revision: 3, seq: 41n })).resolves.toEqual(activated);
    expect(calls).toEqual([{ method: 'POST', path: `/api/projects/${PROJECT}/process/activate`, body: { revision: 3, seq: 41n } }]);
  });
});
