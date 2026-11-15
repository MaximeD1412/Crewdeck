import {
  eventPayloadSchema,
  PROCESS_CREWDECK,
  PROCESS_CREWDECK_NAME,
  type ProjectProcess,
  RESOURCES,
  STATE_SLICES,
  zProcessDraftInput,
  zProjectProcess,
} from '../index.js';

const bytes = (length: number): string => Buffer.alloc(length, 7).toString('base64url');
const SEALED = { key: bytes(60), ciphertext: bytes(32) };

const VIEW: ProjectProcess = {
  id: '019a6f00-0000-7000-8000-000000000011',
  active: {
    number: 1,
    definition: PROCESS_CREWDECK,
    sealed: null,
    activatedAt: '2026-11-15T08:00:00.000Z',
    activatedBy: 'creation',
    templateName: PROCESS_CREWDECK_NAME,
  },
  draft: { definition: PROCESS_CREWDECK, sealed: null, revision: 2, baseVersion: 1, updatedAt: '2026-11-15T09:00:00.000Z' },
};

/** « Process Crewdeck » with one Commande on its « Checks ». */
const withCommand = () => {
  const definition = structuredClone(PROCESS_CREWDECK);
  definition.commands.push({ id: 'e2e' });
  return definition;
};

describe('zProjectProcess', () => {
  it('is the payload of process.upserted and the item of the processes slice', () => {
    expect(RESOURCES).toContain('process');
    expect(eventPayloadSchema('process.upserted')?.parse(VIEW)).toEqual(VIEW);
    expect(STATE_SLICES.processes.parse([VIEW])).toEqual([VIEW]);
  });

  it('has no active version while a Projet’s first draft has a Manque, its draft then based on 0', () => {
    const view = { ...VIEW, active: null, draft: { ...VIEW.draft, revision: 1, baseVersion: 0 } };
    expect(zProjectProcess.parse(view)).toEqual(view);
    expect(zProjectProcess.safeParse({ ...VIEW, draft: { ...VIEW.draft, revision: 0 } }).success).toBe(false);
    expect(zProjectProcess.safeParse({ ...VIEW, active: { ...VIEW.active, number: 0 } }).success).toBe(false);
    expect(zProjectProcess.safeParse({ ...VIEW, active: { ...VIEW.active, activatedBy: 'import' } }).success).toBe(false);
  });
});

describe('zProcessDraftInput', () => {
  const input = { definition: PROCESS_CREWDECK, sealed: null, revision: 0, baseVersion: 1 };

  it('takes the whole draft, the revision it was based on and its version', () => {
    expect(zProcessDraftInput.parse(input)).toEqual(input);
    expect(zProcessDraftInput.parse({ ...input, baseVersion: 0 })).toMatchObject({ baseVersion: 0 });
    expect(zProcessDraftInput.safeParse({ ...input, revision: -1 }).success).toBe(false);
    expect(zProcessDraftInput.safeParse({ ...input, revision: 1.5 }).success).toBe(false);
  });

  it('wants the sealed part beside a Commande, and none without', () => {
    expect(zProcessDraftInput.parse({ ...input, definition: withCommand(), sealed: SEALED })).toMatchObject({ sealed: SEALED });
    const missing = zProcessDraftInput.safeParse({ ...input, definition: withCommand() });
    expect(missing.error?.issues.map((issue) => issue.path)).toEqual([['sealed']]);
    const extra = zProcessDraftInput.safeParse({ ...input, sealed: SEALED });
    expect(extra.error?.issues.map((issue) => issue.path)).toEqual([['sealed']]);
  });

  it('refuses a definition this schema refuses, at its path', () => {
    const definition = structuredClone(PROCESS_CREWDECK);
    for (const phase of definition.phases.slice(0, 1)) phase.id = 'Pas un id';
    expect(zProcessDraftInput.safeParse({ ...input, definition }).error?.issues.map((issue) => issue.path)).toEqual([['definition', 'phases', 0, 'id']]);
  });
});
