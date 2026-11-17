import { folderCheckedAad, type FolderCheckResult } from '@crewdeck/contracts';
import { fromBase64Url } from '../keys/bytes.js';
import {
  FOLDER_CHECK_DEBOUNCE_MS,
  FOLDER_CHECK_TIMEOUT_MS,
  createFolderCheck,
  createFolderChecker,
  type FolderCheckOutcome,
} from './folder-check.js';
import { fakeFolderSocket, fakeSealed, fakeVault } from './testing.js';

const REQUEST = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a92';
const READY: FolderCheckResult = { state: 'ready', hasCode: true, branch: 'main', name: 'recettes' };

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkFolder', () => {
  const setup = (open = true) => {
    const socket = fakeFolderSocket(open);
    let n = 0;
    const checkFolder = createFolderCheck({ socket, vault: fakeVault(), newId: () => `${REQUEST.slice(0, -1)}${n++}` });
    return { socket, checkFolder };
  };

  it('sends the path sealed under `folder.check:<requestId>`, never in clear, and opens the Runner’s answer', async () => {
    const { socket, checkFolder } = setup();
    const checking = checkFolder('~/projets/recettes');
    await flush();

    const [frame] = socket.sent;
    expect(frame).toMatchObject({ type: 'folder.check', requestId: `${REQUEST.slice(0, -1)}0` });
    const plaintext = new TextDecoder().decode(fromBase64Url(frame?.sealed.ciphertext ?? ''));
    expect(plaintext).toBe(`folder.check:${frame?.requestId}{"path":"~/projets/recettes"}`);
    expect(JSON.stringify(frame)).not.toContain('~/projets/recettes');

    socket.receive({ type: 'folder.checked', requestId: frame?.requestId ?? '', sealed: await fakeSealed(JSON.stringify(READY), folderCheckedAad(frame?.requestId ?? '')) });
    await expect(checking).resolves.toEqual(READY);
    expect(socket.listening()).toBe(0);
  });

  it('ignores the answers of other checks, and one that does not open, until its own', async () => {
    const { socket, checkFolder } = setup();
    const checking = checkFolder('/srv/site');
    await flush();
    const requestId = socket.sent[0]?.requestId ?? '';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let settled = false;
    void checking.then(() => (settled = true));

    socket.receive({ type: 'folder.checked', requestId: REQUEST, sealed: await fakeSealed(JSON.stringify(READY), folderCheckedAad(REQUEST)) });
    socket.receive({ type: 'folder.checked', requestId, sealed: await fakeSealed(JSON.stringify(READY), folderCheckedAad(REQUEST)) });
    socket.receive({ type: 'folder.checked', requestId, sealed: await fakeSealed('{"state":"ready"}', folderCheckedAad(requestId)) });
    await flush();
    expect(settled).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);

    socket.receive({ type: 'folder.checked', requestId, sealed: await fakeSealed(JSON.stringify({ ...READY, state: 'not-git' }), folderCheckedAad(requestId)) });
    await expect(checking).resolves.toMatchObject({ state: 'not-git' });
    warn.mockRestore();
  });

  it('is `runner-offline` on the server’s `folder.error`', async () => {
    const { socket, checkFolder } = setup();
    const checking = checkFolder('/srv/site');
    await flush();

    socket.receive({ type: 'folder.error', requestId: socket.sent[0]?.requestId ?? '', code: 'runner.offline' });
    await expect(checking).resolves.toEqual({ state: 'runner-offline' });
  });

  it('is `timeout` when no answer came in 10 s, or when no socket is open', async () => {
    const { socket, checkFolder } = setup();
    const checking = checkFolder('/srv/site');
    await flush();
    let outcome: FolderCheckOutcome | null = null;
    void checking.then((value) => (outcome = value));

    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_TIMEOUT_MS - 1);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ state: 'timeout' });
    expect(socket.listening()).toBe(0);

    await expect(setup(false).checkFolder('/srv/site')).resolves.toEqual({ state: 'timeout' });
  });
});

describe('createFolderChecker', () => {
  const setup = () => {
    const pending: { path: string; resolve: (outcome: FolderCheckOutcome) => void }[] = [];
    const check = vi.fn(
      (path: string) =>
        new Promise<FolderCheckOutcome>((resolve) => {
          pending.push({ path, resolve });
        }),
    );
    const checker = createFolderChecker({ check });
    const changes = vi.fn<() => void>();
    checker.subscribe(changes);
    return { checker, check, pending, changes };
  };

  it('is idle until a path is typed, then `checking` at once and asks the Runner 400 ms after the last keystroke', async () => {
    const { checker, check, changes } = setup();
    expect(checker.state()).toEqual({ path: '', check: { state: 'idle', hasCode: false }, result: null });

    checker.type('~/pro');
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEBOUNCE_MS - 1);
    checker.type('~/projets/recettes');
    expect(checker.state()).toMatchObject({ path: '~/projets/recettes', check: { state: 'checking' } });
    expect(changes).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEBOUNCE_MS - 1);
    expect(check).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(check.mock.calls).toEqual([['~/projets/recettes']]);
  });

  it('shows the answer of the path typed last, with the folder’s result', async () => {
    const { checker, pending } = setup();
    checker.type('~/projets/recettes');
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEBOUNCE_MS);

    pending[0]?.resolve(READY);
    await flush();
    expect(checker.state()).toEqual({ path: '~/projets/recettes', check: { state: 'ready', hasCode: true }, result: READY });
  });

  it('drops an earlier answer arriving late: the last request wins', async () => {
    const { checker, pending } = setup();
    checker.type('~/projets/a');
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEBOUNCE_MS);
    checker.type('~/projets/ab');
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEBOUNCE_MS);

    pending[1]?.resolve({ state: 'missing', hasCode: false, branch: null, name: 'ab' });
    await flush();
    pending[0]?.resolve(READY);
    await flush();
    expect(checker.state()).toMatchObject({ path: '~/projets/ab', check: { state: 'missing', hasCode: false } });

    checker.type('');
    pending[1]?.resolve(READY);
    expect(checker.state()).toEqual({ path: '', check: { state: 'idle', hasCode: false }, result: null });
  });

  it('says `runner-offline` and `timeout` with no result to create from', async () => {
    const { checker, pending } = setup();
    checker.type('/srv/site');
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEBOUNCE_MS);
    pending[0]?.resolve({ state: 'runner-offline' });
    await flush();

    expect(checker.state()).toEqual({ path: '/srv/site', check: { state: 'runner-offline', hasCode: false }, result: null });
  });

  it('a check that throws (the vault locked) leaves it idle; `reset` forgets the path', async () => {
    const checker = createFolderChecker({ check: () => Promise.reject(new Error('keys: the vault is locked')) });
    checker.type('/srv/site');
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEBOUNCE_MS);
    await flush();
    expect(checker.state()).toMatchObject({ path: '/srv/site', check: { state: 'idle' } });

    checker.reset();
    expect(checker.state()).toEqual({ path: '', check: { state: 'idle', hasCode: false }, result: null });
  });
});
