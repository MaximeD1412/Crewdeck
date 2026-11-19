import type { Decision } from '@crewdeck/contracts';
import { COMPOSANTS } from '@crewdeck/sdk';
import type { z } from 'zod';
import type { Client } from '../../api/client.js';
import { aToiView } from '../a-toi.js';
import { decisionViews } from './registry.js';
import { sourceMigrationFailedView, sourceMigrationUnfinishedView } from './source-migration.js';

const NOW = new Date('2026-11-19T10:25:00.000Z');
const MIGRATION_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6b11';
const PROJECT_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03';
const LINK = `/projets/${PROJECT_ID}/process?onglet=sources`;

const decision = (kind: 'source-migration.failed' | 'source-migration.unfinished', params: Decision['params'], metaParts: string[]): Decision => ({
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6c11',
  kind,
  projectId: PROJECT_ID,
  projectName: 'Site mairie',
  subjectType: 'source-migration',
  subjectId: MIGRATION_ID,
  label: 'Tickets de Site mairie',
  metaParts,
  tone: kind === 'source-migration.failed' ? 'halt' : 'caution',
  link: LINK,
  params,
  state: 'open',
  outcome: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  resolvedAt: null,
});

const failed = decision('source-migration.failed', { migrationId: MIGRATION_ID, group: 'ticket', from: 'local', to: 'github', code: 'copy-failed' }, ['Sources']);
const unfinished = decision('source-migration.unfinished', { migrationId: MIGRATION_ID, group: 'ticket', from: 'local', to: 'github' }, ['tickets/ pas encore archivé']);

const row = (item: Decision, runnerOnline = true) => {
  const data = aToiView([item], {}, { runnerOnline, now: NOW });
  expect(COMPOSANTS.PageAToi.data.parse(data)).toEqual(data);
  return data.decisions[0];
};

describe('the Décisions of a migration of Source in « À toi »', () => {
  it('shows a failed migration: nothing switched, « Réessayer » on the Runner as primary, then « Ouvrir » the Sources', () => {
    expect(decisionViews.viewOf('source-migration.failed')).toBe(sourceMigrationFailedView);
    expect(row(failed)).toEqual({
      id: failed.id,
      kind: 'Migration de Source échouée',
      title: 'Tickets de Site mairie',
      meta: 'Site mairie · Sources · il y a 25 min',
      context: 'La migration des Tickets de Local vers GitHub a échoué (copy-failed) : rien n’a basculé, ils restent sur Local.',
      tone: 'halt',
      icon: 'refresh',
      actions: [
        { id: 'retry', label: 'Réessayer', primary: true, disabledReason: null },
        { id: 'open', label: 'Ouvrir', primary: false, disabledReason: null },
      ],
    });
    expect(row(failed, false)?.actions[0]?.disabledReason).not.toBeNull();
  });

  it('retries the migration through its route, and opens the Sources at the Décision’s link', async () => {
    const calls: unknown[] = [];
    const client = {
      command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
        calls.push({ method, path, body });
        return schema?.parse({
          id: MIGRATION_ID,
          projectId: PROJECT_ID,
          group: 'ticket',
          from: 'local',
          to: 'github',
          state: 'draining',
          total: 0,
          copied: 0,
          waitingItems: [],
          errorCode: null,
          attempt: 2,
          createdAt: '2026-11-19T10:00:00.000Z',
          switchedAt: null,
          endedAt: null,
        });
      }) as Client['command'],
    };
    const navigate = vi.fn();
    for (const id of ['retry', 'open']) await sourceMigrationFailedView.actions.find((action) => action.id === id)?.run(failed, { navigate, client });

    expect(calls).toEqual([{ method: 'POST', path: `/api/source-migrations/${MIGRATION_ID}/retry`, body: {} }]);
    expect(navigate).toHaveBeenCalledWith(LINK);
  });

  it('shows an old Source not yet frozen: the new one wins, the Runner tries again, « Ouvrir » only', () => {
    expect(decisionViews.viewOf('source-migration.unfinished')).toBe(sourceMigrationUnfinishedView);
    expect(row(unfinished)).toMatchObject({
      kind: 'Ancienne Source pas encore figée',
      meta: 'Site mairie · tickets/ pas encore archivé · il y a 25 min',
      context: 'Les Tickets sont sur GitHub ; l’ancienne place sur Local n’est pas encore figée, le Runner réessaie toutes les heures.',
      tone: 'caution',
      icon: 'folder',
      actions: [{ id: 'open', label: 'Ouvrir', primary: false, disabledReason: null }],
    });
  });
});
