import type { Decision } from '@crewdeck/contracts';
import { COMPOSANTS } from '@crewdeck/sdk';
import type { z } from 'zod';
import type { Client } from '../../api/client.js';
import { aToiView } from '../a-toi.js';
import { loopBackExhaustedView } from './loop-back-exhausted.js';
import { decisionViews, type DecisionReads } from './registry.js';

/** What the row reads beyond its Décision: nothing this kind needs. */
const READS: DecisionReads = { runnerOnline: true, sessionEvent: () => ({ state: 'reading' }), roleName: (role) => role };

const NOW = new Date('2026-11-16T10:25:00.000Z');
const PHASE_RUN_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6b01';
const SESSION_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6d01';

const exhausted = (params: Partial<Decision['params']> = {}, link = '/a-toi'): Decision => ({
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6c01',
  kind: 'loop-back.exhausted',
  projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03',
  projectName: 'Site mairie',
  subjectType: 'phase-run',
  subjectId: PHASE_RUN_ID,
  label: '#57 Recherche d’actes',
  metaParts: ['Review'],
  tone: 'caution',
  link,
  params: {
    phaseRunId: PHASE_RUN_ID,
    itemType: 'ticket',
    stepRunId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6e01',
    stepName: 'Review',
    targetName: 'Code',
    taken: 3,
    max: 3,
    canContinue: true,
    sessionId: null,
    ...params,
  } as Decision['params'],
  state: 'open',
  outcome: null,
  createdAt: '2026-11-16T10:00:00.000Z',
  resolvedAt: null,
});

const row = (decision: Decision) => {
  const data = aToiView([decision], {}, { runnerOnline: true, now: NOW });
  expect(COMPOSANTS.PageAToi.data.parse(data)).toEqual(data);
  return data.decisions[0];
};

const recording = () => {
  const calls: unknown[] = [];
  const client = {
    command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
      calls.push({ method, path, body });
      return schema?.parse({
        id: PHASE_RUN_ID,
        projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03',
        processVersion: 1,
        builtinTemplate: null,
        parentPhaseRunId: null,
        phaseId: 'ph-dev',
        itemType: 'ticket',
        itemId: '57',
        state: 'running',
        waitingOn: null,
        loopBacks: [],
        startedAt: '2026-11-16T09:00:00.000Z',
        endedAt: null,
      });
    }) as Client['command'],
  };
  return { calls, client };
};

describe('the « Maximum de Retours atteint » Décision in « À toi »', () => {
  it('is registered: the item, its Projet and Étape, the changes asked counted, « Encore un passage » as primary then « Arrêter »', () => {
    expect(decisionViews.viewOf('loop-back.exhausted')).toBe(loopBackExhaustedView);
    expect(row(exhausted())).toEqual({
      id: exhausted().id,
      kind: 'Maximum de Retours atteint',
      title: '#57 Recherche d’actes',
      meta: 'Site mairie · Review · il y a 25 min',
      context: 'Review a demandé des changements 4 fois, le maximum de son Retour vers « Code » : le Ticket s’est arrêté.',
      tone: 'caution',
      icon: 'undo',
      actions: [
        { id: 'one-more-pass', label: 'Encore un passage', primary: true, disabledReason: null },
        { id: 'stop', label: 'Arrêter', primary: false, disabledReason: null },
      ],
    });
  });

  it('offers « Voir la Session » with a Session, to the Décision’s link', () => {
    const decision = exhausted({ sessionId: SESSION_ID }, `/a-toi?session=${SESSION_ID}`);
    expect(row(decision)?.actions.map((action) => action.label)).toEqual(['Encore un passage', 'Arrêter', 'Voir la Session']);

    const navigate = vi.fn();
    void loopBackExhaustedView.actions.find((action) => action.id === 'open-session')?.run(decision, { navigate, client: recording().client });
    expect(navigate).toHaveBeenCalledWith(`/a-toi?session=${SESSION_ID}`);
  });

  it('offers only « Arrêter » when no Retour leaves the Étape, and says it has none', () => {
    const decision = exhausted({ targetName: null, taken: null, max: null, canContinue: false });
    expect(row(decision)?.context).toBe('Review a demandé des changements et n’a pas de Retour : le Ticket s’est arrêté.');
    expect(row(decision)?.actions.map((action) => action.id)).toEqual(['stop']);
  });

  it('says what stopped by the item’s type', () => {
    expect(loopBackExhaustedView.context?.(exhausted({ itemType: 'idea' }), READS)).toMatch(/: l’Idée s’est arrêtée\.$/);
    expect(loopBackExhaustedView.context?.(exhausted({ itemType: 'prd' }), READS)).toMatch(/: le travail s’est arrêté\.$/);
  });

  it('answers through the PhaseRun’s routes, naming the Décision', async () => {
    const { calls, client } = recording();
    const decision = exhausted();
    const navigate = vi.fn();
    for (const id of ['one-more-pass', 'stop']) await loopBackExhaustedView.actions.find((action) => action.id === id)?.run(decision, { navigate, client });

    expect(calls).toEqual([
      { method: 'POST', path: `/api/phase-runs/${PHASE_RUN_ID}/one-more-pass`, body: { decisionId: decision.id } },
      { method: 'POST', path: `/api/phase-runs/${PHASE_RUN_ID}/stop`, body: { decisionId: decision.id } },
    ]);
    expect(navigate).not.toHaveBeenCalled();
  });
});
