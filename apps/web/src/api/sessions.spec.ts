import type { z } from 'zod';
import type { Client } from './client.js';
import { getSession, resumeSession, stopSession } from './sessions.js';

const SESSION = {
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6d01',
  projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03',
  role: 'design',
  engine: 'claude-code',
  model: 'claude-opus-5-5',
  title: 'Conception · agenda partagé',
  titleSealed: null,
  state: 'stopped',
  interruptedReason: null,
  outcome: null,
  error: null,
  stepRunId: null,
  branch: 'conception/agenda',
  startedAt: '2026-11-17T14:00:00.000Z',
  endedAt: '2026-11-17T15:12:00.000Z',
};

describe('the Session routes of the page', () => {
  it('post « Arrêter » and « Reprendre » to the Session’s routes and answer the Session', async () => {
    const calls: unknown[] = [];
    const client = {
      command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
        calls.push({ method, path, body });
        return schema?.parse(SESSION);
      }) as Client['command'],
    };

    await expect(stopSession(client, SESSION.id)).resolves.toMatchObject({ id: SESSION.id, state: 'stopped' });
    await resumeSession(client, SESSION.id);
    expect(calls).toEqual([
      { method: 'POST', path: `/api/sessions/${SESSION.id}/stop`, body: {} },
      { method: 'POST', path: `/api/sessions/${SESSION.id}/resume`, body: {} },
    ]);
  });

  it('read one Session by its id', async () => {
    const paths: string[] = [];
    const client = {
      query: (async (path: string, schema: z.ZodType) => {
        paths.push(path);
        return schema.parse(SESSION);
      }) as Client['query'],
    };

    await expect(getSession(client, SESSION.id)).resolves.toMatchObject({ id: SESSION.id });
    expect(paths).toEqual([`/api/sessions/${SESSION.id}`]);
  });
});
