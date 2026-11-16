import { COMPOSANTS, t } from '@crewdeck/sdk';
import type { z } from 'zod';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { fromBase64Url, utf8 } from './keys/bytes.js';
import type { VaultState } from './keys/vault.js';
import { createNoteIdea } from './note-idea.js';
import type { StoreState } from './store/store.js';

const ID = '019a8c3e-5f00-7a10-8c2c-000000000065';
const CREWDECK = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01';
const PERSONAL_OS = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02';
const TEXT = 'Pouvoir dupliquer une recette';
const KEY = new Uint8Array(60).fill(7);

const setup = ({ vaultState = 'unlocked' as VaultState, width = 1280, refuse = null as ApiError | null } = {}) => {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const sealed: { plaintext: string; aad: string }[] = [];
  const client = {
    command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
      calls.push({ method, path, body: body as Record<string, unknown> });
      if (refuse) throw refuse;
      return schema?.parse({
        ...body,
        number: 65,
        targetProjectId: null,
        targetIsNew: false,
        state: 'to-triage',
        analysis: null,
        impact: null,
        effort: null,
        duplicateIds: [],
        mergedIntoId: null,
        reason: null,
        ticketNumber: null,
        createdAt: '2026-11-16T10:00:00.000Z',
        updatedAt: '2026-11-16T10:00:00.000Z',
        analysedAt: null,
        triagedAt: null,
      });
    }) as Client['command'],
  };
  const vault = {
    sealItem: vi.fn(async (plaintext: Uint8Array, aad: Uint8Array) => {
      sealed.push({ plaintext: new TextDecoder().decode(plaintext), aad: new TextDecoder().decode(aad) });
      // Not the text: a ciphertext the server cannot read back.
      return { key: KEY, ciphertext: new Uint8Array(12 + plaintext.length + 16).fill(9) };
    }),
  };
  const projects = new Map([
    [PERSONAL_OS, { id: PERSONAL_OS, displayName: 'Personal OS' }],
    [CREWDECK, { id: CREWDECK, displayName: 'Crewdeck' }],
  ]);
  const store = { getState: () => ({ vaultState, slices: { project: projects } }) as unknown as StoreState };
  const noteIdea = createNoteIdea({ client, vault, store, width: () => width, newId: () => ID });
  const changed = vi.fn<() => void>();
  noteIdea.subscribe(changed);
  return { noteIdea, calls, sealed, vault, changed };
};

describe('createNoteIdea', () => {
  it('opens the Dialog with the Projets by name and the default one, and closes it on cancel', () => {
    const { noteIdea, changed } = setup();
    expect(noteIdea.view()).toMatchObject({ open: false });
    noteIdea.open(PERSONAL_OS);
    const view = noteIdea.view();
    expect(COMPOSANTS.NoteIdeaDialog.data.parse(view)).toEqual(view);
    expect(view).toEqual({
      open: true,
      busy: false,
      error: null,
      defaultProjectId: PERSONAL_OS,
      locked: false,
      projects: [
        { id: CREWDECK, name: 'Crewdeck' },
        { id: PERSONAL_OS, name: 'Personal OS' },
      ],
    });
    noteIdea.cancel();
    expect(noteIdea.view().open).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('seals the trimmed text under "<id>:text" and sends only its ciphertext, with the Projet, from the pc', async () => {
    const { noteIdea, calls, sealed } = setup();
    noteIdea.open(null);
    await noteIdea.submit({ text: `  ${TEXT}\n`, projectId: PERSONAL_OS });
    expect(sealed).toEqual([{ plaintext: TEXT, aad: `${ID}:text` }]);
    expect(calls).toHaveLength(1);
    const [{ method, path, body }] = calls as [(typeof calls)[number]];
    expect([method, path]).toEqual(['POST', '/api/ideas']);
    expect(body).toMatchObject({ id: ID, projectId: PERSONAL_OS, notedFrom: 'pc', dictated: false });
    const text = body['text'] as { key: string; ciphertext: string };
    expect(fromBase64Url(text.key)).toEqual(KEY);
    expect(JSON.stringify(body)).not.toContain(TEXT);
    expect(JSON.stringify(body)).not.toContain(Buffer.from(utf8(TEXT)).toString('base64url'));
    expect(noteIdea.view()).toMatchObject({ open: false, busy: false, error: null });
  });

  it('notes from the telephone below 1280 px, without a Projet', async () => {
    const { noteIdea, calls } = setup({ width: 390 });
    noteIdea.open(null);
    await noteIdea.submit({ text: TEXT, projectId: null });
    expect(calls[0]?.body).toMatchObject({ projectId: null, notedFrom: 'telephone' });
  });

  it('refuses an empty text before sealing anything', async () => {
    const { noteIdea, calls, vault } = setup();
    noteIdea.open(null);
    await noteIdea.submit({ text: '  \n ', projectId: null });
    expect(vault.sealItem).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(noteIdea.view()).toMatchObject({ open: true, busy: false, error: t('idees.note.empty') });
  });

  it('is locked while this Appareil cannot seal, and never sends', async () => {
    const { noteIdea, calls, vault } = setup({ vaultState: 'no-device' });
    noteIdea.open(null);
    expect(noteIdea.view().locked).toBe(true);
    await noteIdea.submit({ text: TEXT, projectId: null });
    expect(vault.sealItem).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(noteIdea.view().error).toBe('Approuve cet Appareil pour noter une Idée.');
  });

  it('keeps the Dialog open with the server’s refusal: its field’s message, else its own', async () => {
    const gone = setup({ refuse: new ApiError({ status: 404, code: 'project.not-found', message: 'Ce Projet est introuvable.' }) });
    gone.noteIdea.open(CREWDECK);
    await gone.noteIdea.submit({ text: TEXT, projectId: CREWDECK });
    expect(gone.noteIdea.view()).toMatchObject({ open: true, busy: false, error: 'Ce Projet est introuvable.' });

    const field = setup({ refuse: new ApiError({ status: 400, code: 'validation', message: 'Invalide', fields: { 'text.ciphertext': 'Trop court' } }) });
    field.noteIdea.open(null);
    await field.noteIdea.submit({ text: TEXT, projectId: null });
    expect(field.noteIdea.view().error).toBe('Trop court');
  });

  it('is busy while the Idée is on its way, and takes no second submit nor cancel meanwhile', async () => {
    const { noteIdea, vault } = setup();
    let release: () => void = () => undefined;
    vault.sealItem.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ key: KEY, ciphertext: new Uint8Array(40) }))),
    );
    noteIdea.open(null);
    const first = noteIdea.submit({ text: TEXT, projectId: null });
    expect(noteIdea.view().busy).toBe(true);
    await noteIdea.submit({ text: TEXT, projectId: null });
    noteIdea.cancel();
    expect(noteIdea.view()).toMatchObject({ open: true, busy: true });
    release();
    await first;
    expect(vault.sealItem).toHaveBeenCalledTimes(1);
    expect(noteIdea.view().open).toBe(false);
  });
});
