import type { z } from 'zod';
import type { Client } from './client.js';
import { oneMorePass, stopPhaseRun } from './phase-runs.js';

const PHASE_RUN = {
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6b01',
  projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03',
  processVersion: 1,
  builtinTemplate: null,
  parentPhaseRunId: null,
  phaseId: 'ph-dev',
  itemType: 'ticket',
  itemId: '57',
  state: 'running',
  waitingOn: null,
  loopBacks: [{ from: 'st-review', to: 'st-code', taken: 4, extra: 1 }],
  startedAt: '2026-11-16T09:00:00.000Z',
  endedAt: null,
};
const DECISION_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6c01';

describe('the answers to « Maximum de Retours atteint »', () => {
  it('post the Décision answered to the PhaseRun’s route and answer the PhaseRun', async () => {
    const calls: unknown[] = [];
    const client = {
      command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
        calls.push({ method, path, body });
        return schema?.parse(PHASE_RUN);
      }) as Client['command'],
    };

    await expect(oneMorePass(client, PHASE_RUN.id, DECISION_ID)).resolves.toMatchObject({ id: PHASE_RUN.id, state: 'running' });
    await stopPhaseRun(client, PHASE_RUN.id, DECISION_ID);
    expect(calls).toEqual([
      { method: 'POST', path: `/api/phase-runs/${PHASE_RUN.id}/one-more-pass`, body: { decisionId: DECISION_ID } },
      { method: 'POST', path: `/api/phase-runs/${PHASE_RUN.id}/stop`, body: { decisionId: DECISION_ID } },
    ]);
  });
});
