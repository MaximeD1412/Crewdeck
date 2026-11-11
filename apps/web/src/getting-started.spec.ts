import type { BrowserPairing, ConfirmPairing, Me, Runner, RunnerLink, RunnerPairing, State } from '@crewdeck/contracts';
import type { z } from 'zod';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { CONFIRM_RETRY_MS, createGettingStarted, drawSecret, gettingStartedGuard, type GettingStarted } from './getting-started.js';
import type { LinkKeys, PendingLink } from './keys/pairing.js';
import { matchRoute } from './router.js';
import { ROUTES } from './routes.js';
import { createStore, type Store } from './store/store.js';

const ME: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'runner' };
const LINK_ID = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a70';
const AT = '2026-11-11T14:12:00.000Z';
const SECRET = 'M2PXA7QK9VZ3T8W4R6N1B5C0DE';
const RUNNER: Runner = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a71',
  machine: 'atelier-pc',
  os: 'linux',
  arch: 'amd64',
  wsl: false,
  runnerVersion: '0.4.2',
  state: 'online',
  lastSeenAt: AT,
  linkedAt: AT,
};
const DEVICE_ID = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a74';
const RUNNER_ID = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a75';
const BROWSER_PAIRING: BrowserPairing = { devicePublicKey: 'D'.repeat(43), deviceName: 'Chrome sur Linux' };
const RUNNER_PAIRING: RunnerPairing = { runnerPublicKey: 'R'.repeat(43), proof: 'P'.repeat(43) };
/** A Runner key the server swapped: the fake keys find its proof does not match. */
const SWAPPED: RunnerPairing = { runnerPublicKey: 'S'.repeat(43), proof: 'P'.repeat(43) };
const wrap = { enc: 'E'.repeat(43), ciphertext: 'C'.repeat(64), tag: 'T'.repeat(43) };
const CONFIRM: ConfirmPairing = { proof: 'Q'.repeat(43), vaultKeyVersion: 1, runnerVaultWrap: wrap, deviceVaultWrap: wrap };
const CONFIG = { githubApiUrl: 'https://api.github.com', githubWebUrl: 'https://github.com', appSlug: 'crewdeck', runnerServer: null };

const link = (overrides: Partial<RunnerLink> = {}): RunnerLink => ({
  id: LINK_ID,
  shortId: '7KQ4',
  state: 'waiting',
  failureReason: null,
  expiresAt: AT,
  runnerId: null,
  runnerPairing: null,
  ...overrides,
});

describe('gettingStartedGuard', () => {
  const guarded = (step: Me['gettingStartedStep'] | null, url: string) =>
    gettingStartedGuard(() => (step ? { gettingStartedStep: step } : null))(matchRoute(ROUTES, url));

  it.each(['/a-toi', '/idees/x', '/parametres/composants', '/connexion', '/nope'])('sends %s to /demarrage until the Premiers pas are done', (url) => {
    expect(guarded('runner', url)).toBe('/demarrage');
    expect(guarded('projects', url)).toBe('/demarrage');
  });

  it('lets /demarrage be until done, then sends it to « À toi »', () => {
    expect(guarded('ai-accounts', '/demarrage')).toBeNull();
    expect(guarded('done', '/demarrage')).toBe('/a-toi');
    expect(guarded('done', '/a-toi')).toBeNull();
  });

  it('lets the sign-in’s guard decide signed out', () => {
    expect(guarded(null, '/demarrage')).toBeNull();
  });
});

describe('drawSecret', () => {
  it('draws 26 Crockford characters, a new one each time', () => {
    const secret = drawSecret();
    expect(secret).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(drawSecret()).not.toBe(secret);
  });
});

const pending = (runnerPairing: RunnerPairing = RUNNER_PAIRING): Partial<RunnerLink> => ({ state: 'pending', runnerId: RUNNER_ID, runnerPairing });

describe('createGettingStarted', () => {
  let store: Store;
  let adopted: string[];
  let asked: PendingLink[];
  let unlocks: number;
  let seq: number;
  let commands: { method: string; path: string; body: object }[];
  let answers: Record<string, () => unknown>;
  let controller: GettingStarted;

  const client: Pick<Client, 'command' | 'query'> = {
    query: (async () => CONFIG) as Client['query'],
    command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
      commands.push({ method, path, body });
      const answer = answers[path]?.();
      return schema ? schema.parse(answer) : undefined;
    }) as Client['command'],
  };

  const snapshot = (overrides: Partial<State> = {}) =>
    store.applySnapshot({ seq: seq++, pilot: ME, runner: null, 'runner-link': null, devices: [], ...overrides });
  const event = (type: 'runner-link.upserted' | 'runner.upserted' | 'pilot.upserted', payload: unknown) =>
    store.applyEvent({ seq: seq++, type, payload, at: AT } as Parameters<Store['applyEvent']>[0]);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    store = createStore();
    for (const slice of ['pilot', 'runner', 'runner-link'] as const) store.registerSlice(slice, { shape: 'single' });
    seq = 1;
    commands = [];
    adopted = [];
    asked = [];
    unlocks = 0;
    answers = {
      '/api/runner/link-codes': () => ({ id: LINK_ID, shortId: '7KQ4', expiresAt: AT, deviceId: DEVICE_ID }),
      [`/api/runner/link-codes/${LINK_ID}/confirm`]: () => ({ runner: RUNNER }),
      '/api/me/getting-started/advance': () => ({ ...ME, gettingStartedStep: 'ai-accounts' }),
    };
    const keys: LinkKeys = {
      browserPairing: async () => BROWSER_PAIRING,
      adoptDevice: async (id) => {
        adopted.push(id);
      },
      confirmPairing: async (asking) => {
        asked.push(asking);
        return asking.runnerPairing.runnerPublicKey === SWAPPED.runnerPublicKey ? null : CONFIRM;
      },
    };
    const unlockVault = async () => {
      unlocks++;
    };
    controller = createGettingStarted({ store, client, bootPilot: ME, origin: 'https://crewdeck.example', system: 'linux', secret: () => SECRET, keys, unlockVault });
    store.subscribe(() => controller.sync());
  });

  it('waits for the snapshot, then draws one code whose secret stays in the page', async () => {
    controller.sync();
    expect(commands).toEqual([]);
    snapshot();
    await flush();
    expect(commands).toEqual([{ method: 'POST', path: '/api/runner/link-codes', body: { pairing: BROWSER_PAIRING } }]);
    expect(JSON.stringify(commands)).not.toContain(SECRET);
    expect(adopted).toEqual([DEVICE_ID]);
    expect(controller.view()).toMatchObject({
      step: 'runner',
      shortId: '7KQ4',
      command: `curl -fsSL https://crewdeck.example/runner/install.sh | sh -s -- --link 7KQ4-${SECRET}`,
      failure: null,
    });
    event('runner-link.upserted', link());
    await flush();
    expect(commands).toHaveLength(1);
  });

  it('confirms its pending code once, when the Runner’s pairing is there, then opens the vault', async () => {
    snapshot();
    await flush();
    event('runner-link.upserted', link({ state: 'pending' }));
    expect(commands).toHaveLength(1);
    event('runner-link.upserted', link(pending()));
    event('runner-link.upserted', link(pending()));
    await flush();
    expect(asked).toEqual([{ secret: SECRET, shortId: '7KQ4', runnerId: RUNNER_ID, runnerPairing: RUNNER_PAIRING }]);
    expect(commands.slice(1)).toEqual([{ method: 'POST', path: `/api/runner/link-codes/${LINK_ID}/confirm`, body: { pairing: CONFIRM } }]);
    expect(JSON.stringify(commands)).not.toContain(SECRET);
    expect(unlocks).toBe(1);
    event('runner.upserted', RUNNER);
    expect(controller.view()).toMatchObject({ command: null, runner: { machine: 'atelier-pc' } });
  });

  it('confirms its pending code again after a confirmation that failed, until one goes through', async () => {
    vi.useFakeTimers();
    try {
      let refusals = 1;
      answers[`/api/runner/link-codes/${LINK_ID}/confirm`] = () => {
        if (refusals-- > 0) throw new Error('réseau');
        return { runner: RUNNER };
      };
      snapshot();
      await vi.advanceTimersByTimeAsync(0);
      event('runner-link.upserted', link(pending()));
      await vi.advanceTimersByTimeAsync(0);
      expect(commands.filter((c) => c.path.endsWith('/confirm'))).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(CONFIRM_RETRY_MS);
      expect(commands.filter((c) => c.path.endsWith('/confirm'))).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(CONFIRM_RETRY_MS * 3);
      event('runner-link.upserted', link(pending()));
      await vi.advanceTimersByTimeAsync(0);
      expect(commands.filter((c) => c.path.endsWith('/confirm'))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the vault once its code is linked, even when the confirmation’s answer was lost on its way back', async () => {
    vi.useFakeTimers();
    try {
      // The server applied the confirmation, its answer never reached the page.
      answers[`/api/runner/link-codes/${LINK_ID}/confirm`] = () => {
        throw new Error('réseau');
      };
      snapshot();
      await vi.advanceTimersByTimeAsync(0);
      event('runner-link.upserted', link(pending()));
      await vi.advanceTimersByTimeAsync(0);
      expect(unlocks).toBe(0);

      event('runner-link.upserted', link({ ...pending(), state: 'linked' }));
      event('runner.upserted', RUNNER);
      await vi.advanceTimersByTimeAsync(CONFIRM_RETRY_MS * 2);
      expect(unlocks).toBe(1);
      expect(commands.filter((c) => c.path.endsWith('/confirm'))).toHaveLength(1);
      event('runner-link.upserted', link({ ...pending(), state: 'linked' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(unlocks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the vault once when both the confirmation’s answer and the linked event arrive', async () => {
    snapshot();
    await flush();
    event('runner-link.upserted', link(pending()));
    await flush();
    event('runner-link.upserted', link({ ...pending(), state: 'linked' }));
    event('runner.upserted', RUNNER);
    await flush();
    expect(unlocks).toBe(1);
  });

  it('does not open the vault for a linked code it did not draw', async () => {
    snapshot();
    await flush();
    event('runner-link.upserted', link({ ...pending(), id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7f', state: 'linked' }));
    await flush();
    expect(unlocks).toBe(0);
  });

  it('rejects its code when the Runner’s proof does not match the key the server relayed, and confirms nothing', async () => {
    snapshot();
    await flush();
    event('runner-link.upserted', link(pending(SWAPPED)));
    await flush();
    expect(commands.slice(1)).toEqual([{ method: 'POST', path: `/api/runner/link-codes/${LINK_ID}/reject`, body: { reason: 'pairing-mismatch' } }]);
    expect(unlocks).toBe(0);
  });

  it('does not confirm again a code the server refused (an Appareil not trusted): its failure shows through its event', async () => {
    vi.useFakeTimers();
    try {
      answers[`/api/runner/link-codes/${LINK_ID}/confirm`] = () => {
        throw new ApiError({ status: 422, code: 'devices.not-trusted', message: 'refusé' });
      };
      snapshot();
      await vi.advanceTimersByTimeAsync(0);
      event('runner-link.upserted', link(pending()));
      await vi.advanceTimersByTimeAsync(CONFIRM_RETRY_MS * 3);
      expect(commands.filter((c) => c.path.endsWith('/confirm'))).toHaveLength(1);
      expect(unlocks).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles the failure of a code once, even when it comes again', async () => {
    snapshot();
    await flush();
    event('runner-link.upserted', link({ state: 'failed', failureReason: 'no-engine' }));
    await flush();
    event('runner-link.upserted', link({ state: 'failed', failureReason: 'no-engine' }));
    await flush();
    expect(commands).toHaveLength(2);
  });

  it('ignores a code that is not its own', async () => {
    snapshot();
    await flush();
    event('runner-link.upserted', link({ id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7f', ...pending() }));
    event('runner-link.upserted', link({ id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7f', state: 'failed', failureReason: 'no-engine' }));
    await flush();
    expect(commands).toHaveLength(1);
  });

  it.each(['no-engine', 'unsupported-system', 'already-used', 'pairing-mismatch', 'device-not-trusted'] as const)('after its code failed (%s), keeps the reason and draws a new code', async (reason) => {
    snapshot();
    await flush();
    answers['/api/runner/link-codes'] = () => ({ id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a72', shortId: '9RTB', expiresAt: AT, deviceId: DEVICE_ID });
    event('runner-link.upserted', link({ state: 'failed', failureReason: reason }));
    await flush();
    expect(commands.map((c) => c.path)).toEqual(['/api/runner/link-codes', '/api/runner/link-codes']);
    expect(controller.view()).toMatchObject({ failure: { reason, shortId: '7KQ4' }, shortId: '9RTB' });
  });

  it('an expired code too', async () => {
    snapshot();
    await flush();
    answers['/api/runner/link-codes'] = () => ({ id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a72', shortId: '9RTB', expiresAt: AT, deviceId: DEVICE_ID });
    event('runner-link.upserted', link({ state: 'expired', failureReason: 'expired' }));
    await flush();
    expect(commands).toHaveLength(2);
    expect(controller.view().failure).toEqual({ reason: 'expired', shortId: '7KQ4' });
  });

  it('shows at load the reason of the Pilote’s last failed code, then « Réessayer » clears it with a new code', async () => {
    snapshot({ 'runner-link': link({ id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a73', shortId: '9RTB', state: 'expired', failureReason: 'expired' }) });
    await flush();
    expect(controller.view()).toMatchObject({ failure: { reason: 'expired', shortId: '9RTB' }, shortId: '7KQ4' });
    await controller.retry();
    expect(commands).toHaveLength(2);
    expect(controller.view()).toMatchObject({ failure: null, shortId: '7KQ4' });
  });

  it('draws nothing once a Runner is linked, nor off the Runner’s step', async () => {
    snapshot({ runner: RUNNER });
    snapshot({ pilot: { ...ME, gettingStartedStep: 'ai-accounts' } });
    await flush();
    expect(commands).toEqual([]);
  });

  it('adds --server from /api/config off production', async () => {
    client.query = (async () => ({ ...CONFIG, runnerServer: 'http://localhost:4200' })) as Client['query'];
    snapshot();
    await flush();
    expect(controller.view().command).toMatch(/ --server http:\/\/localhost:4200$/);
    client.query = (async () => CONFIG) as Client['query'];
  });

  it('switches the tab without a new code', async () => {
    snapshot();
    await flush();
    const listener = vi.fn<() => void>();
    controller.subscribe(listener);
    controller.selectSystem('macos');
    expect(listener).toHaveBeenCalledOnce();
    expect(controller.view()).toMatchObject({ system: 'macos', shortId: '7KQ4' });
    expect(commands).toHaveLength(1);
  });

  it('« Continuer » is busy on its way, then shows the next step before the event and the store’s pilot after it', async () => {
    snapshot({ runner: RUNNER });
    const advancing = controller.advance();
    expect(controller.view().busy).toBe(true);
    await advancing;
    expect(commands).toEqual([{ method: 'POST', path: '/api/me/getting-started/advance', body: { from: 'runner' } }]);
    expect(controller.view()).toMatchObject({ busy: false, step: 'ai-accounts' });
    expect(controller.pilot()?.gettingStartedStep).toBe('ai-accounts');
    event('pilot.upserted', { ...ME, login: 'renamed', gettingStartedStep: 'ai-accounts' });
    expect(controller.pilot()?.login).toBe('renamed');
  });

  it('« Continuer » refused: not busy any more, the step unchanged, the error to the page', async () => {
    snapshot({ runner: RUNNER });
    answers['/api/me/getting-started/advance'] = () => {
      throw new Error('refused');
    };
    await expect(controller.advance()).rejects.toThrow('refused');
    expect(controller.view()).toMatchObject({ busy: false, step: 'runner' });
  });
});
