import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, type ProcessDefinition, type ProcessDraftInput, type ProcessSources, type ProjectProcess } from '@crewdeck/contracts';
import { AppError } from '../errors/app-error.js';
import { Prisma } from '../generated/prisma/client.js';
import type { EventsWriter } from '../realtime/events.writer.js';
import type { Transactions, Tx } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { ProcessService } from './process.service.js';

const PILOT = '019a6f00-0000-7000-8000-000000000001';
const PROJECT = '019a6f00-0000-7000-8000-000000000011';
const FIXTURES = join(import.meta.dirname, '../../../../packages/contracts/fixtures/process');

interface Fixture {
  readonly definition: ProcessDefinition;
  readonly sources: ProcessSources;
  readonly refusals: readonly { kind: string; target: string; label: string }[];
}
const fixture = (name: string): Fixture => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Fixture;

type Row = Record<string, unknown>;

/** The tables `ProcessService` touches, in memory: what it queries of Prisma, nothing more. */
const fakeDatabase = (projects: string[] = [PROJECT]) => {
  const versions: Row[] = [];
  const drafts: Row[] = [];
  const pick = (row: Row | undefined): Row | null => (row ? { ...row } : null);
  /** As PostgreSQL stores it: `Prisma.DbNull` is SQL's NULL. */
  const stored = (data: Row): Row => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === Prisma.DbNull ? null : value]));
  const tx = {
    project: {
      updateMany: async ({ where }: { where: { id: string } }) => ({ count: projects.includes(where.id) ? 1 : 0 }),
    },
    processVersion: {
      create: async ({ data }: { data: Row }) => {
        if (versions.some((row) => row['projectId'] === data['projectId'] && row['number'] === data['number'])) throw new Error('unique (projectId, number)');
        versions.push(stored(data));
        return { id: data['id'] };
      },
      findFirst: async ({ where }: { where: { projectId: string } }) =>
        pick(versions.filter((row) => row['projectId'] === where.projectId).sort((a, b) => Number(b['number']) - Number(a['number']))[0]),
    },
    processDraft: {
      create: async ({ data }: { data: Row }) => {
        drafts.push(stored(data));
        return { id: data['id'] };
      },
      findUnique: async ({ where }: { where: { projectId: string } }) => pick(drafts.find((row) => row['projectId'] === where.projectId)),
      upsert: async ({ where, create, update }: { where: { projectId: string }; create: Row; update: Row }) => {
        const row = drafts.find((candidate) => candidate['projectId'] === where.projectId);
        if (row) Object.assign(row, stored(update));
        else drafts.push(stored(create));
        return {};
      },
    },
  };
  const events: { type: string; payload: ProjectProcess }[] = [];
  const writer = {
    lock: async () => undefined,
    write: async (_tx: unknown, _pilotId: string, type: string, payload: ProjectProcess) => {
      events.push({ type, payload: structuredClone(payload) });
      return BigInt(events.length);
    },
  };
  const transactions = { run: <T>(fn: (tx: Tx) => Promise<T>) => fn(tx as unknown as Tx) };
  const service = new ProcessService(transactions as unknown as Transactions, writer as unknown as EventsWriter);
  return { tx: tx as unknown as Tx, service, versions, drafts, events };
};

const inScope = <T>(fn: () => Promise<T>): Promise<T> => runInPilotScope(PILOT, fn);

const GITHUB: ProcessSources = { ticket: 'github', code: 'github' };
const LOCAL: ProcessSources = { ticket: 'github', code: 'local' };

const draftInput = (edit: Partial<ProcessDraftInput> = {}): ProcessDraftInput => ({ definition: PROCESS_CREWDECK, sealed: null, revision: 0, baseVersion: 1, ...edit });

const appError = async (promise: Promise<unknown>): Promise<AppError> => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
};

describe('ProcessService.createInitialVersion', () => {
  it('writes version 1, « Process Crewdeck » copied by the creation, no draft, and its process.upserted', async () => {
    const db = fakeDatabase();

    const view = await inScope(() => db.service.createInitialVersion(db.tx, PROJECT, { template: 'process-crewdeck' }, GITHUB));

    expect(view).toEqual({
      id: PROJECT,
      active: { number: 1, definition: PROCESS_CREWDECK, sealed: null, activatedAt: expect.any(String), activatedBy: 'creation', templateName: PROCESS_CREWDECK_NAME },
      draft: null,
    });
    expect(db.versions).toEqual([expect.objectContaining({ pilotId: PILOT, projectId: PROJECT, number: 1 })]);
    expect(db.drafts).toEqual([]);
    expect(db.events).toEqual([{ type: 'process.upserted', payload: view }]);
  });

  it('writes no version but a draft based on 0 when the copy has a Manque on the Projet’s Sources (code Local)', async () => {
    const db = fakeDatabase();
    expect(fixture('crewdeck-local').sources.code).toBe('local');

    const view = await inScope(() => db.service.createInitialVersion(db.tx, PROJECT, { template: 'process-crewdeck' }, LOCAL));

    expect(view.active).toBeNull();
    expect(view.draft).toEqual({ definition: PROCESS_CREWDECK, sealed: null, revision: 1, baseVersion: 0, updatedAt: expect.any(String) });
    expect(db.versions).toEqual([]);
    expect(db.events.map((event) => event.type)).toEqual(['process.upserted']);
  });
});

describe('ProcessService.saveDraft', () => {
  const created = async () => {
    const db = fakeDatabase();
    await inScope(() => db.service.createInitialVersion(db.tx, PROJECT, { template: 'process-crewdeck' }, GITHUB));
    db.events.length = 0;
    return db;
  };

  it('creates the draft at revision 1 from revision 0, then 2 from 1, each with its process.upserted', async () => {
    const db = await created();

    const first = await inScope(() => db.service.saveDraft(PROJECT, draftInput()));
    expect(first.draft).toMatchObject({ revision: 1, baseVersion: 1 });
    expect(first.active?.number).toBe(1);

    const second = await inScope(() => db.service.saveDraft(PROJECT, draftInput({ revision: 1 })));
    expect(second.draft).toMatchObject({ revision: 2 });
    expect(db.drafts).toHaveLength(1);
    expect(db.events.map((event) => event.payload.draft?.revision)).toEqual([1, 2]);
  });

  it('is 409 process.draft-stale for a revision another tab saved past, or none yet', async () => {
    const db = await created();
    await inScope(() => db.service.saveDraft(PROJECT, draftInput()));
    await inScope(() => db.service.saveDraft(PROJECT, draftInput({ revision: 1 })));

    const error = await appError(inScope(() => db.service.saveDraft(PROJECT, draftInput({ revision: 1 }))));
    expect(error).toMatchObject({ status: 409, code: 'process.draft-stale' });
    expect(error.message).toBe('Le brouillon a changé dans un autre onglet : recharge-le avant de continuer.');

    const fresh = await created();
    expect(await appError(inScope(() => fresh.service.saveDraft(PROJECT, draftInput({ revision: 3 }))))).toMatchObject({ status: 409, code: 'process.draft-stale' });
    expect(fresh.events).toEqual([]);
  });

  it('is 409 process.draft-stale for a baseVersion other than the active one', async () => {
    const db = await created();
    for (const baseVersion of [0, 2]) {
      expect(await appError(inScope(() => db.service.saveDraft(PROJECT, draftInput({ baseVersion }))))).toMatchObject({ status: 409, code: 'process.draft-stale' });
    }
    expect(db.drafts).toEqual([]);
  });

  it('saves a draft based on 0 while the Projet has no version', async () => {
    const db = fakeDatabase();
    await inScope(() => db.service.createInitialVersion(db.tx, PROJECT, { template: 'process-crewdeck' }, LOCAL));

    const view = await inScope(() => db.service.saveDraft(PROJECT, draftInput({ baseVersion: 0, revision: 1 })));
    expect(view.draft).toMatchObject({ revision: 2, baseVersion: 0 });
    expect(await appError(inScope(() => db.service.saveDraft(PROJECT, draftInput({ baseVersion: 1, revision: 2 }))))).toMatchObject({ code: 'process.draft-stale' });
  });

  it.each(['arrow-cycle', 'core-missing-checks', 'id-duplicate-step', 'refusals-combined'])(
    'is 422 process.invalid for the refusals of %s, each target in fields with its label',
    async (name) => {
      const db = await created();
      const { definition, refusals } = fixture(name);
      expect(refusals.length).toBeGreaterThan(0);

      const error = await appError(inScope(() => db.service.saveDraft(PROJECT, draftInput({ definition }))));

      expect(error).toMatchObject({ status: 422, code: 'process.invalid', message: 'Ce Process ne peut pas être dessiné ainsi.' });
      expect(Object.keys(error.fields ?? {}).sort()).toEqual([...new Set(refusals.map((refusal) => refusal.target))].sort());
      const first = refusals[0];
      expect(error.fields?.[first?.target ?? '']).toBe(first?.label);
      expect(db.drafts).toEqual([]);
    },
  );

  it('saves a draft with only Manques: they forbid activation, not the save', async () => {
    const db = await created();
    const { definition, refusals } = fixture('input-unfed');
    expect(refusals).toEqual([]);

    expect((await inScope(() => db.service.saveDraft(PROJECT, draftInput({ definition })))).draft?.definition).toEqual(definition);
  });

  it('is 404 project.not-found for a Projet the scope does not hold', async () => {
    const db = fakeDatabase([]);
    expect(await appError(inScope(() => db.service.saveDraft(PROJECT, draftInput())))).toMatchObject({ status: 404, code: 'project.not-found' });
  });
});
