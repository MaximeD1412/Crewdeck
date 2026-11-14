import {
  LINK_CODE_SECRET_LENGTH,
  zMe,
  zPublicConfig,
  zRunnerLinkCodeCreated,
  zRunnerLinkConfirmed,
  type GettingStartedStep,
  type LinkFailureReason,
  type Me,
  type PublicConfig,
} from '@crewdeck/contracts';
import type { DemarrageSystem } from '@crewdeck/sdk';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { encodeBase32 } from './keys/base32.js';
import type { LinkKeys, PendingLink } from './keys/pairing.js';
import type { VaultState } from './keys/vault.js';
import type { RouteMatch } from './router.js';
import { HOME_PATH } from './sign-in.js';
import type { Store } from './store/store.js';
import { demarrageView, type DemarrageView, type DrawnCode } from './views/demarrage.js';

/** « Premiers pas », where a Pilote signed in stays until their step is `done`. */
export const GETTING_STARTED_PATH = '/demarrage';

/**
 * The router's guard of « Premiers pas » (US-2), on the Pilote the page knows
 * now: until their step is `done`, every page (`/connexion` included, which
 * would lead to « À toi ») goes to `/demarrage`; once `done`, `/demarrage`
 * goes to « À toi ». Signed out, it lets the sign-in's guard decide.
 */
export const gettingStartedGuard =
  (pilot: () => Pick<Me, 'gettingStartedStep'> | null) =>
  (match: RouteMatch): string | null => {
    const current = pilot();
    if (!current) return null;
    const here = match.path === GETTING_STARTED_PATH;
    if (current.gettingStartedStep === 'done') return here ? HOME_PATH : null;
    return here ? null : GETTING_STARTED_PATH;
  };

/** How long after a confirmation that failed (the network, the server) the page confirms its pending code again. */
export const CONFIRM_RETRY_MS = 2000;

/** 128 bits from `crypto.getRandomValues`, 26 Crockford characters (ADR 0003). */
export const drawSecret = (): string => {
  const secret = encodeBase32(crypto.getRandomValues(new Uint8Array(16)));
  if (secret.length !== LINK_CODE_SECRET_LENGTH) throw new Error('secret de liaison mal formé');
  return secret;
};

export interface GettingStartedOptions {
  readonly store: Store;
  readonly client: Pick<Client, 'command' | 'query'>;
  /** The Pilote of `/api/me` at boot, until the snapshot gives the store's. */
  readonly bootPilot: Me | null;
  /** Where the page is served (`location.origin`). */
  readonly origin: string;
  /** The tab open first. */
  readonly system: DemarrageSystem;
  readonly secret?: () => string;
  /** This browser's Appareil and the pairing's crypto (E2E-2). */
  readonly keys: LinkKeys;
  /** Opens the vault once the Runner is linked: the Appareil now holds its wrap. */
  readonly unlockVault: () => Promise<VaultState>;
}

/** A refusal the same request would get again (not the network, not the server down, not a stale `seq`). */
const final = (error: unknown): boolean => error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 409;

export interface GettingStarted {
  /** The Pilote as the page knows them now: the answer of « Continuer » until the store's pilot changes, the store's, else the boot's. */
  pilot(): Me | null;
  /** The data of `cd-page-demarrage`. */
  view(): DemarrageView;
  /** To call on each change of the store: draws the first code, confirms a `pending` one, draws again after a failure. */
  sync(): void;
  selectSystem(system: DemarrageSystem): void;
  retry(): Promise<void>;
  advance(): Promise<void>;
  /** Calls `fn` after each change of the page's own state; returns the function that stops. */
  subscribe(fn: () => void): () => void;
}

/**
 * The page's side of linking the Runner (RUNNER-3): it draws a code whose
 * secret never leaves it, follows the `runner-link` slice for that code only,
 * confirms it once the Runner is there (`pending` with its pairing, whose
 * proof the page checks: a key the server swapped makes it reject the code,
 * E2E-2), opens the vault once linked, and after a failure keeps its
 * reason for the Banner and draws a new code. At load, the reason of the
 * Pilote's last failed code shows the same way. The Runner linked, « Continuer »
 * moves the Pilote to their next step.
 */
export const createGettingStarted = ({
  store,
  client,
  bootPilot,
  origin,
  system: firstSystem,
  secret = drawSecret,
  keys,
  unlockVault,
}: GettingStartedOptions): GettingStarted => {
  const listeners = new Set<() => void>();
  let system = firstSystem;
  let code: (DrawnCode & { readonly id: string }) | null = null;
  let failure: { reason: LinkFailureReason; shortId: string } | null = null;
  let config: PublicConfig | null = null;
  let started = false;
  let drawing = false;
  /** The codes confirmed or being confirmed (one that failed leaves it, to be confirmed again), and those whose failure was already shown: each handled once. */
  const confirmed = new Set<string>();
  const failed = new Set<string>();
  /** The step « Continuer » leaves, while its command is on its way. */
  let advancing: GettingStartedStep | null = null;
  /** Its answer, and the store's pilot it was given over. */
  let answered: { readonly me: Me; readonly over: Me | null | undefined } | null = null;
  /**
   * The vault opens on the confirmation's answer or on the store showing the
   * page's code linked, whichever comes first: once it opened (or the browser
   * has no Appareil the server knows), never again; an opening that ended
   * `locked` (the wrap not fetched) is tried again at the next of them, also
   * when it arrived while that opening was on its way.
   */
  let vaultOpening: 'idle' | 'opening' | 'done' = 'idle';
  let openAgain = false;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const pilot = (): Me | null => {
    const slice = store.getState().slices.pilot;
    if (answered && answered.over === slice) return answered.me;
    return slice !== undefined ? slice : bootPilot;
  };

  const openVault = () => {
    if (vaultOpening === 'done') return;
    if (vaultOpening === 'opening') {
      openAgain = true;
      return;
    }
    vaultOpening = 'opening';
    openAgain = false;
    void unlockVault()
      .catch((): VaultState => 'locked')
      .then((result) => {
        vaultOpening = result === 'locked' ? 'idle' : 'done';
        if (vaultOpening === 'idle' && openAgain) openVault();
      });
  };

  const draw = async () => {
    if (drawing) return;
    drawing = true;
    code = null;
    notify();
    const drawn = secret();
    try {
      const pairing = await keys.browserPairing();
      const [created, read] = await Promise.all([
        client.command('POST', '/api/runner/link-codes', { pairing }, zRunnerLinkCodeCreated),
        config ? Promise.resolve(config) : client.query('/api/config', zPublicConfig),
      ]);
      await keys.adoptDevice(created.deviceId);
      config = read;
      code = { id: created.id, shortId: created.shortId, secret: drawn };
    } finally {
      drawing = false;
      notify();
    }
    sync();
  };

  const confirm = async (drawn: DrawnCode & { readonly id: string }, link: Pick<PendingLink, 'runnerId' | 'runnerPairing'>) => {
    try {
      const pairing = await keys.confirmPairing({ secret: drawn.secret, shortId: drawn.shortId, ...link });
      if (!pairing) {
        // The Runner's proof does not match the keys the server relayed: the code fails, the page shows why and draws another.
        await client.command('POST', `/api/runner/link-codes/${drawn.id}/reject`, { reason: 'pairing-mismatch' });
        return;
      }
      await client.command('POST', `/api/runner/link-codes/${drawn.id}/confirm`, { pairing }, zRunnerLinkConfirmed);
    } catch (error) {
      // A refusal (`devices.not-trusted`: the code failed, its event shows why) is not sent again.
      if (final(error)) return;
      // Still `pending` for the page: confirmed again a little later, or at the next change of the store. The code's expiry ends it.
      confirmed.delete(drawn.id);
      setTimeout(sync, CONFIRM_RETRY_MS);
      return;
    }
    openVault();
  };

  function sync() {
    const { slices } = store.getState();
    const me = pilot();
    if (answered && answered.over !== slices.pilot) answered = null;
    if (!me || me.gettingStartedStep !== 'runner' || slices.runner === undefined || slices['runner-link'] === undefined) return;
    const last = slices['runner-link'];
    // The confirmation went through even when its answer was lost: its event says so.
    if (code && last?.id === code.id && last.state === 'linked') openVault();
    if (slices.runner) return;
    if (!started) {
      started = true;
      if (last) failed.add(last.id);
      if (last?.failureReason && (last.state === 'failed' || last.state === 'expired')) failure = { reason: last.failureReason, shortId: last.shortId };
      void draw();
      return;
    }
    if (!code || !last || last.id !== code.id) return;
    if (last.state === 'pending' && last.runnerPairing && last.runnerId && !confirmed.has(last.id)) {
      confirmed.add(last.id);
      void confirm(code, { runnerId: last.runnerId, runnerPairing: last.runnerPairing });
    } else if ((last.state === 'failed' || last.state === 'expired') && last.failureReason && !failed.has(last.id)) {
      failed.add(last.id);
      failure = { reason: last.failureReason, shortId: code.shortId };
      void draw();
    }
  }

  return {
    pilot,
    view() {
      const me = pilot();
      const { slices } = store.getState();
      return demarrageView({
        pilot: me ?? { displayName: '', gettingStartedStep: 'runner' },
        runner: slices.runner ?? null,
        system,
        code,
        failure,
        busy: advancing !== null,
        origin,
        server: config?.runnerServer ?? null,
        accounts: [...(slices['ai-account']?.values() ?? [])],
      });
    },
    sync,
    selectSystem(next) {
      system = next;
      notify();
    },
    async retry() {
      failure = null;
      await draw();
    },
    async advance() {
      const me = pilot();
      if (!me || me.gettingStartedStep === 'done' || advancing) return;
      advancing = me.gettingStartedStep;
      notify();
      try {
        const next = await client.command('POST', '/api/me/getting-started/advance', { from: advancing }, zMe);
        answered = { me: next, over: store.getState().slices.pilot };
      } finally {
        advancing = null;
        notify();
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
