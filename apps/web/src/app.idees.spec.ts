import { DEFAULT_ACCOUNT_SETTINGS, type Idea, type Me, type Project } from '@crewdeck/contracts';
import { MenuItem } from '@crewdeck/sdk';
import type { z } from 'zod';
import { createDispatcher } from './actions/dispatcher.js';
import type { Client } from './api/client.js';
import { boot, type App } from './app.js';
import { toBase64Url, utf8 } from './keys/bytes.js';
import type { PageKeys } from './keys/index.js';
import type { SealedItem } from './keys/vault.js';
import { holdsIdea } from './store/ideas.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [] };
const PERSONAL_OS = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02';
const AT = '2026-11-16T08:00:00.000Z';

const project: Project = {
  id: PERSONAL_OS,
  repositoryId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6b02',
  owner: 'maxime',
  name: 'personal-os',
  fullName: 'maxime/personal-os',
  displayName: 'Personal OS',
  releaseBranch: 'main',
  integrationBranch: 'develop',
  hasCode: true,
  inventoryState: 'not-needed',
  accessLost: false,
  followedAt: AT,
};

/** The fake vault seals a text as itself: what the page shows is what it sealed. */
const idea = (number: number, text: string, fields: Partial<Idea> = {}): Idea => ({
  id: `0193a4f2-7c1e-7a10-8c2c-0000000000${number}`,
  number,
  projectId: PERSONAL_OS,
  targetProjectId: null,
  targetIsNew: false,
  state: 'to-triage',
  text: { key: toBase64Url(new Uint8Array(60)), ciphertext: toBase64Url(utf8(text)) },
  analysis: null,
  impact: null,
  effort: null,
  duplicateIds: [],
  notedFrom: 'pc',
  dictated: false,
  mergedIntoId: null,
  reason: null,
  ticketNumber: null,
  createdAt: AT,
  updatedAt: AT,
  analysedAt: null,
  triagedAt: null,
  ...fields,
});

type WithData = HTMLElement & { data: unknown };
interface PageData {
  readonly toTriage: number;
  readonly empty: boolean;
  readonly ideas: readonly { readonly id: string; readonly title: string; readonly meta: string }[];
  readonly older: string;
  readonly tabs: readonly { readonly id: string; readonly count: number; readonly selected: boolean }[];
}
interface DialogData {
  readonly open: boolean;
  readonly defaultProjectId: string | null;
  readonly locked: boolean;
  readonly error: string | null;
}

const store = createStore();
store.registerSlice('pilot', { shape: 'single' });
store.registerSlice('decision', { shape: 'collection', snapshotKey: 'decisions' });
store.registerSlice('project', { shape: 'collection', snapshotKey: 'projects' });
store.registerSlice('idea', { shape: 'collection', snapshotKey: 'ideas', holds: (item) => holdsIdea(item as Idea) });
const commands: { path: string; body: Record<string, unknown> }[] = [];
const queries: string[] = [];
/** Merged and rejected more than 90 days ago: beyond the snapshot, from `GET /api/ideas`, two pages. */
const OLD = '2026-07-01T08:00:00.000Z';
const client = {
  query: (async (path: string, schema: z.ZodType) => {
    queries.push(path);
    if (!path.startsWith('/api/ideas?states=merged,rejected')) throw new Error(`no query ${path} in this spec`);
    const page = path.includes('cursor=')
      ? { items: [idea(39, 'Trier par couleur', { state: 'merged', createdAt: OLD, updatedAt: OLD })], nextCursor: null }
      : { items: [idea(40, 'Imprimer les menus', { state: 'merged', createdAt: OLD, updatedAt: OLD }), idea(41, 'Un thème sombre', { state: 'rejected', createdAt: OLD, updatedAt: OLD })], nextCursor: 'page-2' };
    return schema.parse(page);
  }) as Client['query'],
  command: (async (_method: string, path: string, body: object, schema?: z.ZodType) => {
    commands.push({ path, body: body as Record<string, unknown> });
    const sent = body as { id: string; text: Idea['text']; projectId: string | null };
    return schema?.parse(idea(65, '', { id: sent.id, text: sent.text, projectId: sent.projectId }));
  }) as Client['command'],
};
const vault = {
  sealItem: async (plaintext: Uint8Array) => ({ key: new Uint8Array(60), ciphertext: new Uint8Array(plaintext) }),
  openItem: async (item: SealedItem) => new Uint8Array(item.ciphertext),
};
const keys = {
  linkKeys: {} as PageKeys['linkKeys'],
  vault: vault as unknown as PageKeys['vault'],
  nameDevice: async () => undefined,
  unlockVault: async () => {
    store.setVaultState('unlocked');
    return 'unlocked' as const;
  },
  approval: {} as PageKeys['approval'],
};
let app: App;
let root: HTMLElement;

const page = () => root.querySelector<WithData>('cd-page-idees');
const pageData = () => page()?.data as PageData;
const dialog = () => root.querySelector<WithData>('cd-note-idea-dialog');
const dialogData = () => dialog()?.data as DialogData;
const ideesCount = () =>
  [...root.querySelectorAll<WithData>(MenuItem.tag)].map((item) => item.data as { id: string; count: number | null }).find((item) => item.id === 'idees')?.count;
const act = (composant: string, action: string, payload: unknown) => app.dispatcher.dispatch({ composant, action, payload });

beforeAll(async () => {
  history.replaceState(null, '', '/idees');
  root = document.createElement('div');
  document.body.append(root);
  app = await boot({
    root,
    dispatcher: createDispatcher(),
    me: async () => PILOT,
    store,
    client,
    keys,
    connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() },
  });
});

afterAll(() => app.stop());

describe('« Idées » follows the store', () => {
  it('with only Idées merged or rejected more than 90 days ago, is not empty: « Fusionnées » shows them, and the next page on « Afficher les plus anciennes »', async () => {
    await vi.waitFor(() => expect(pageData().tabs.map((tab) => tab.count)).toEqual([0, 0, 1, 1]));
    expect(pageData()).toMatchObject({ empty: false, ideas: [] });
    app.router.navigate('/idees?onglet=fusionnees');
    await vi.waitFor(() => expect(pageData().ideas.map((row) => row.title)).toEqual(['Imprimer les menus']));
    expect(pageData().older).toBe('available');
    await act('PageIdees', 'more', {});
    await vi.waitFor(() => expect(pageData().ideas.map((row) => row.title)).toEqual(['Imprimer les menus', 'Trier par couleur']));
    expect(pageData().older).toBe('none');
    expect(queries).toEqual(['/api/ideas?states=merged,rejected', '/api/ideas?states=merged,rejected&cursor=page-2']);
    app.router.navigate('/idees');
  });

  it('then lists the snapshot’s Idées in clear, the Cadre counting those to triage', async () => {
    store.applySnapshot({ seq: 3, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [], 'mcp-server': [], devices: [], projects: [project], processes: [], phaseRuns: [], stepRuns: [], repositories: [], decisions: [], ideas: [idea(63, 'Exporter le planning'), idea(50, 'Ancienne', { state: 'retained' })], tickets: [], milestones: [], codeChanges: [], sessions: [], settings: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' } });
    store.markLive();
    await vi.waitFor(() => expect(pageData().ideas.map((row) => row.title)).toEqual(['Exporter le planning']));
    expect(pageData()).toMatchObject({ empty: false, toTriage: 1 });
    expect(ideesCount()).toBe(1);
  });

  it('shows an Idée noted elsewhere at the top of « À trier », without a reload', async () => {
    const shown = page();
    store.applyEvent({ seq: 4, type: 'idea.upserted', payload: idea(64, 'Pouvoir dupliquer une recette\nSur le téléphone'), at: AT });
    await vi.waitFor(() => expect(pageData().ideas.map((row) => row.title)).toEqual(['Pouvoir dupliquer une recette', 'Exporter le planning']));
    expect(page()).toBe(shown);
    expect(pageData().ideas[0]?.meta).toMatch(/^#64 · Personal OS · /);
    expect(ideesCount()).toBe(2);
  });

  it('a chip and a tab move through the URL, keeping each other', () => {
    act('PageIdees', 'filter', { projectId: PERSONAL_OS });
    expect(location.pathname + location.search).toBe(`/idees?projet=${PERSONAL_OS}`);
    act('PageIdees', 'tab', { tab: 'retenues' });
    expect(location.pathname + location.search).toBe(`/idees?projet=${PERSONAL_OS}&onglet=retenues`);
    expect(pageData().tabs.find((tab) => tab.selected)?.id).toBe('retenues');
    act('PageIdees', 'filter', { projectId: null });
    expect(location.pathname + location.search).toBe('/idees?onglet=retenues');
    act('PageIdees', 'tab', { tab: 'a-trier' });
    expect(location.pathname + location.search).toBe('/idees');
  });

  it('« Noter une Idée » opens the Dialog in the Cadre with the page’s Projet; « Annuler » closes it', () => {
    expect(dialog()?.closest('cd-cadre')).toBe(root.firstElementChild);
    expect(dialogData()).toMatchObject({ open: false, locked: false });
    app.router.navigate(`/idees?projet=${PERSONAL_OS}`);
    act('PageIdees', 'note', {});
    expect(dialogData()).toMatchObject({ open: true, defaultProjectId: PERSONAL_OS });
    act('NoteIdeaDialog', 'cancel', {});
    expect(dialogData().open).toBe(false);
    app.router.navigate('/idees');
  });

  it('notes the Idée sealed, and closes the Dialog', async () => {
    act('PageIdees', 'note', {});
    await act('NoteIdeaDialog', 'submit', { text: 'Pouvoir dupliquer une recette', projectId: PERSONAL_OS });
    await vi.waitFor(() => expect(dialogData().open).toBe(false));
    expect(commands.map((command) => command.path)).toEqual(['/api/ideas']);
    expect(commands[0]?.body).toMatchObject({ projectId: PERSONAL_OS, notedFrom: expect.stringMatching(/^(pc|telephone)$/), dictated: false });
  });

  it('opens the same Dialog from « À toi », whose button now shows', () => {
    app.router.navigate('/a-toi');
    expect((root.querySelector<WithData>('cd-page-a-toi')?.data as { canNoteIdea: boolean }).canNoteIdea).toBe(true);
    act('PageAToi', 'note-idea', {});
    expect(location.pathname).toBe('/a-toi');
    expect(dialogData()).toMatchObject({ open: true, defaultProjectId: null });
    act('NoteIdeaDialog', 'cancel', {});
  });

  it('locks the Dialog on an Appareil not approved', () => {
    store.setVaultState('no-device');
    act('PageAToi', 'note-idea', {});
    expect(dialogData()).toMatchObject({ open: true, locked: true });
    act('NoteIdeaDialog', 'cancel', {});
    store.setVaultState('unlocked');
  });
});
