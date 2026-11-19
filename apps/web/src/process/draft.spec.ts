import { type ProcessDefinition, type ProcessDraftInput, PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, type ProjectProcess } from '@crewdeck/contracts';
import { ApiError } from '../api/request.js';
import { addPhase, type EditResult, renamePhase } from './edit.js';
import { createDraftSaver } from './draft.js';

const PROJECT = '019a7000-0000-7000-8000-000000000190';
const ACTIVE: ProjectProcess = {
  id: PROJECT,
  active: { number: 2, definition: PROCESS_CREWDECK, sealed: null, activatedAt: '2026-11-15T08:00:00.000Z', activatedBy: 'creation', templateName: PROCESS_CREWDECK_NAME },
  draft: null,
  sources: { ticket: { source: 'github', since: '2026-11-15T08:00:00.000Z' }, code: { source: 'github', since: '2026-11-15T08:00:00.000Z' } },
  running: [],
};

const answered = (input: ProcessDraftInput): ProjectProcess => ({
  ...ACTIVE,
  draft: { definition: input.definition, sealed: input.sealed, revision: input.revision + 1, baseVersion: input.baseVersion, updatedAt: '2026-11-15T09:00:00.000Z' },
});

type Pending = { input: ProcessDraftInput; resolve: (view: ProjectProcess) => void; reject: (error: unknown) => void };

/** A server that answers when the test says: each PUT waits in `pending`. */
const fakeServer = () => {
  const pending: Pending[] = [];
  const client = {
    command: ((_method: string, _path: string, body: object) =>
      new Promise((resolve, reject) => {
        pending.push({ input: body as ProcessDraftInput, resolve, reject });
      })) as never,
  };
  return { client, pending };
};

const rename = (name: string) => (definition: ProcessDefinition): EditResult => renamePhase(definition, 'ph-dev', name);
const phaseName = (view: ProjectProcess | undefined) => view?.draft?.definition.phases.find((phase) => phase.id === 'ph-dev')?.name;

const setup = (stored: ProjectProcess | undefined = ACTIVE) => {
  const server = fakeServer();
  const failures: string[] = [];
  let current = stored;
  const saver = createDraftSaver({ projectId: PROJECT, client: server.client, stored: () => current, onFailure: (text) => failures.push(text) });
  return { saver, server, failures, store: (view: ProjectProcess) => (current = view) };
};

describe('createDraftSaver', () => {
  it('shows an accepted edit at once, as the draft, before the server answers', () => {
    const { saver } = setup();
    expect(saver.edit(rename('Livraison')).ok).toBe(true);
    expect(phaseName(saver.view())).toBe('Livraison');
    expect(saver.view()?.active).toEqual(ACTIVE.active);
  });

  it('puts the whole definition, revision 0 and the active version the first time', async () => {
    const { saver, server } = setup();
    saver.edit(rename('Livraison'));
    expect(server.pending).toHaveLength(1);
    expect(server.pending[0]?.input).toMatchObject({ revision: 0, baseVersion: 2, sealed: null });
    expect(server.pending[0]?.input.definition.phases.find((phase) => phase.id === 'ph-dev')?.name).toBe('Livraison');
    server.pending[0]?.resolve(answered(server.pending[0].input));
    await saver.settled();
    expect(phaseName(saver.view())).toBe('Livraison');
  });

  it('puts on the draft’s revision and version when there is one', () => {
    const { saver, server } = setup({ ...ACTIVE, draft: { definition: PROCESS_CREWDECK, sealed: null, revision: 4, baseVersion: 2, updatedAt: '2026-11-15T09:00:00.000Z' } });
    saver.edit(rename('Livraison'));
    expect(server.pending[0]?.input).toMatchObject({ revision: 4, baseVersion: 2 });
  });

  it('keeps one PUT in flight: the edits made meanwhile go together in the next, on the revision the answer gave', async () => {
    const { saver, server } = setup();
    saver.edit(rename('Livraison'));
    saver.edit(rename('Livraison 2'));
    saver.edit(addPhase);
    expect(server.pending).toHaveLength(1);
    expect(phaseName(saver.view())).toBe('Livraison 2');
    expect(saver.view()?.draft?.definition.phases).toHaveLength(4);

    const first = server.pending[0] as Pending;
    first.resolve(answered(first.input));
    await vi.waitFor(() => expect(server.pending).toHaveLength(2));
    const second = server.pending[1] as Pending;
    expect(second.input.revision).toBe(1);
    expect(second.input.definition.phases).toHaveLength(4);
    second.resolve(answered(second.input));
    await saver.settled();
    expect(server.pending).toHaveLength(2);
    expect(saver.view()?.draft?.revision).toBe(2);
  });

  it('sends the edits made meanwhile on the revision its own save gave, not on another tab’s that came first', async () => {
    const { saver, server, store } = setup();
    saver.edit(rename('Livraison'));
    saver.edit(addPhase);
    const first = server.pending[0] as Pending;
    // Another tab saved on revision 1: its event (revision 2) arrives before this tab's answer (revision 1).
    const renamed = renamePhase(first.input.definition, 'ph-dev', 'Relecture');
    if (!renamed.ok) throw new Error(renamed.reason);
    const other = answered({ ...first.input, revision: 1, definition: renamed.definition });
    store(other);
    first.resolve(answered(first.input));
    await vi.waitFor(() => expect(server.pending).toHaveLength(2));
    expect(server.pending[1]?.input.revision).toBe(1);
  });

  it('sends nothing for an edit that changes nothing, nor for a refused one', () => {
    const { saver, server } = setup();
    expect(saver.edit(rename('Développement'))).toEqual({ ok: true, definition: PROCESS_CREWDECK });
    expect(saver.edit(rename(''))).toEqual({ ok: false, reason: 'Une Phase a un nom.' });
    expect(server.pending).toHaveLength(0);
    expect(saver.view()).toBe(ACTIVE);
  });

  it('shows the store’s view once it is as recent as the answer', async () => {
    const { saver, server, store } = setup();
    saver.edit(rename('Livraison'));
    const first = server.pending[0] as Pending;
    const view = answered(first.input);
    first.resolve(view);
    await saver.settled();
    const later = { ...view, draft: { ...(view.draft as NonNullable<ProjectProcess['draft']>), revision: 3 } };
    store(later);
    expect(saver.view()).toBe(later);
  });

  it('sends the sealed part only while the definition holds Commandes', () => {
    const sealed = { alg: 'xchacha20poly1305', ciphertext: 'c2VhbGVk', nonce: 'bm9uY2U', keyVersion: 1 };
    const withCommand: ProcessDefinition = {
      ...PROCESS_CREWDECK,
      steps: PROCESS_CREWDECK.steps.map((step) => (step.kind === 'checks' ? { ...step, tools: [{ kind: 'command', commandId: 'checks' }] } : step)),
      commands: [{ id: 'checks' }],
    };
    const { saver, server } = setup({ ...ACTIVE, active: { ...(ACTIVE.active as NonNullable<ProjectProcess['active']>), definition: withCommand, sealed: sealed as never } });
    saver.edit(rename('Livraison'));
    expect(server.pending[0]?.input.sealed).toEqual(sealed);
  });

  it('says a stale draft, and shows the store’s again', async () => {
    const { saver, server, failures } = setup();
    saver.edit(rename('Livraison'));
    server.pending[0]?.reject(new ApiError({ status: 409, code: 'process.draft-stale', message: 'Le brouillon a changé.' }));
    await saver.settled();
    expect(failures).toEqual(['Le brouillon a changé dans un autre onglet : ton dernier changement n’est pas enregistré.']);
    expect(saver.view()).toBe(ACTIVE);
  });

  it('shows the server’s refusal as is', async () => {
    const { saver, server, failures } = setup();
    saver.edit(rename('Livraison'));
    server.pending[0]?.reject(new ApiError({ status: 422, code: 'process.invalid', message: 'Le Process est refusé.' }));
    await saver.settled();
    expect(failures).toEqual(['Le Process est refusé.']);
    expect(saver.view()).toBe(ACTIVE);
  });

  it('says a draft not saved when the call fails without an answer', async () => {
    const { saver, server, failures } = setup();
    saver.edit(rename('Livraison'));
    server.pending[0]?.reject(new TypeError('Failed to fetch'));
    await saver.settled();
    expect(failures).toEqual(['Brouillon non enregistré : vérifie ta connexion.']);
  });

  it('tells its listeners each time what it shows changes', async () => {
    const { saver, server } = setup();
    let calls = 0;
    const stop = saver.subscribe(() => (calls += 1));
    saver.edit(rename('Livraison'));
    expect(calls).toBe(1);
    server.pending[0]?.resolve(answered((server.pending[0] as Pending).input));
    await saver.settled();
    expect(calls).toBe(2);
    stop();
    saver.edit(rename('Livraison 2'));
    expect(calls).toBe(2);
  });
});
