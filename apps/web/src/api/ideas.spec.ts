import type { Idea } from '@crewdeck/contracts';
import type { z } from 'zod';
import type { Client } from './client.js';
import { reanalyseIdea, setIdeaTarget } from './ideas.js';

const AT = '2026-11-16T09:00:00.000Z';
const IDEA: Idea = {
  id: '0193a4f2-7c1e-7a10-8c2c-000000000063',
  number: 63,
  projectId: null,
  targetProjectId: null,
  targetIsNew: true,
  state: 'analysed',
  text: { key: 'k'.repeat(80), ciphertext: 'c'.repeat(40) },
  analysis: null,
  impact: 3,
  effort: 2,
  duplicateIds: [],
  notedFrom: 'pc',
  dictated: false,
  mergedIntoId: null,
  reason: null,
  ticketNumber: null,
  createdAt: AT,
  updatedAt: AT,
  analysedAt: AT,
  triagedAt: null,
  analysisRun: null,
};

describe('the commands of an Idée’s analysis', () => {
  it('« Changer » posts the Projet visé (null for « nouveau »), « Relancer l’analyse » posts nothing more; both answer the Idée', async () => {
    const calls: unknown[] = [];
    const client = {
      command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
        calls.push({ method, path, body });
        return schema?.parse(IDEA);
      }) as Client['command'],
    };

    await expect(setIdeaTarget(client, IDEA.id, null)).resolves.toMatchObject({ id: IDEA.id, targetIsNew: true });
    await setIdeaTarget(client, IDEA.id, '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02');
    await expect(reanalyseIdea(client, IDEA.id)).resolves.toMatchObject({ id: IDEA.id });
    expect(calls).toEqual([
      { method: 'POST', path: `/api/ideas/${IDEA.id}/target`, body: { projectId: null } },
      { method: 'POST', path: `/api/ideas/${IDEA.id}/target`, body: { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02' } },
      { method: 'POST', path: `/api/ideas/${IDEA.id}/reanalyse`, body: {} },
    ]);
  });
});
