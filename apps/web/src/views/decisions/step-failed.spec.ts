import type { Decision } from '@crewdeck/contracts';
import { COMPOSANTS } from '@crewdeck/sdk';
import type { z } from 'zod';
import type { Client } from '../../api/client.js';
import { aToiView, type AToiOptions } from '../a-toi.js';
import { decisionViews, type DecisionReads } from './registry.js';
import { stepFailedView } from './step-failed.js';

const NOW = new Date('2026-11-20T10:25:00.000Z');
const PROJECT_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03';
const STEP_RUN_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6e01';

const failed = (failure: string, params: Partial<Decision['params']> = {}): Decision => ({
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6c02',
  kind: 'step-failed',
  projectId: PROJECT_ID,
  projectName: 'Site mairie',
  subjectType: 'step-run',
  subjectId: STEP_RUN_ID,
  label: 'Review',
  metaParts: ['Développement'],
  tone: 'caution',
  link: `/projets/${PROJECT_ID}`,
  params: { stepRunId: STEP_RUN_ID, phaseRunId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6b01', stepId: 'st-review', itemType: 'ticket', itemId: '57', itemLabelled: false, failure, ...params } as Decision['params'],
  state: 'open',
  outcome: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  resolvedAt: null,
});

const READS: DecisionReads = { runnerOnline: true, sessionEvent: () => ({ state: 'reading' }), roleName: (role) => role, localText: () => '…', ticketTitle: () => null };

const row = (decision: Decision, options: Partial<AToiOptions> = {}) => {
  const data = aToiView([decision], {}, { runnerOnline: true, now: NOW, ...options });
  expect(COMPOSANTS.PageAToi.data.parse(data)).toEqual(data);
  return data.decisions[0];
};

describe('the « Étape échouée » Décision in « À toi »', () => {
  it('is registered: the Étape’s name, the Phase in its meta, why its Session stopped, « Relancer l’Étape » then « Voir », the Runner offline too', () => {
    expect(decisionViews.viewOf('step-failed')).toBe(stepFailedView);
    expect(row(failed('session-error'), { runnerOnline: false })).toEqual({
      id: failed('session-error').id,
      kind: 'Étape échouée',
      title: 'Review',
      meta: 'Site mairie · Développement · il y a 25 min',
      context: 'La session s’est arrêtée en erreur.',
      tone: 'caution',
      icon: 'alert',
      actions: [
        { id: 'rerun', label: 'Relancer l’Étape', primary: true, disabledReason: null },
        { id: 'open', label: 'Voir', primary: false, disabledReason: null },
      ],
    });
  });

  it('says the Runner stopped the Session; nothing for a failure it does not know', () => {
    expect(stepFailedView.context?.(failed('session-stopped'), READS)).toBe('Le Runner a arrêté la session.');
    expect(stepFailedView.context?.(failed('engine-gone'), READS)).toBeNull();
  });

  it('adds the Ticket’s title the page holds when the server could not read it', () => {
    expect(row(failed('session-error'), { ticketTitle: () => 'Recherche d’actes' })?.title).toBe('Review · #57 Recherche d’actes');
  });

  it('« Relancer l’Étape » posts the StepRun’s rerun', async () => {
    const calls: unknown[] = [];
    const client = {
      command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
        calls.push({ method, path, body });
        return schema?.parse({ stepRun: null });
      }) as Client['command'],
    };
    await stepFailedView.actions.find((action) => action.id === 'rerun')?.run(failed('session-error'), { navigate: vi.fn(), client });
    expect(calls).toEqual([{ method: 'POST', path: `/api/step-runs/${STEP_RUN_ID}/rerun`, body: {} }]);
  });
});
