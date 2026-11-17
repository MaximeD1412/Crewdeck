import {
  folderCheckAad,
  folderCheckedAad,
  zFolderCheckResult,
  type FolderCheckResult,
  type FolderFormCheckState,
  type SealedItem as WireSealedItem,
  type TabFolderClientMessage,
  type TabFolderServerMessage,
} from '@crewdeck/contracts';
import { uuidv7 } from '../ids.js';
import { fromBase64Url, toBase64Url, utf8 } from '../keys/bytes.js';
import type { Vault } from '../keys/vault.js';

/**
 * The check of a typed path by the Runner (PROJET-6, ADR 0012): the path
 * leaves the page only sealed under the vault key (`folder.check:<requestId>`),
 * through the page's socket; the server forwards it to the Runner and its
 * answer, sealed the same way (`folder.checked:<requestId>`), to this tab only.
 * Nothing of it is kept beyond the form's memory.
 */

/** The page's socket, as the checks use it (`store/connection.ts`). */
export interface FolderSocket {
  /** Sends on the open socket; false when there is none. */
  sendFolder(message: TabFolderClientMessage): boolean;
  onFolder(listener: (message: TabFolderServerMessage) => void): () => void;
}

/** How long the page waits for the Runner's answer. */
export const FOLDER_CHECK_TIMEOUT_MS = 10_000;
/** How long after the last keystroke the path is checked. */
export const FOLDER_CHECK_DEBOUNCE_MS = 400;

/** The Runner's answer, or why there is none: the server could not reach it, or it did not answer in time. */
export type FolderCheckOutcome = FolderCheckResult | { readonly state: 'runner-offline' | 'timeout' };

const TIMEOUT: FolderCheckOutcome = { state: 'timeout' };
const OFFLINE: FolderCheckOutcome = { state: 'runner-offline' };
const decoder = new TextDecoder('utf-8', { fatal: true });

/** A sealed item on the wire: base64url, as `zSealedItem`. */
export const toWire = (item: { readonly key: Uint8Array; readonly ciphertext: Uint8Array }): WireSealedItem => ({
  key: toBase64Url(item.key),
  ciphertext: toBase64Url(item.ciphertext),
});

export interface FolderCheckOptions {
  readonly socket: FolderSocket;
  readonly vault: Pick<Vault, 'sealItem' | 'openItem'>;
  /** A check's `requestId`: a UUIDv7 drawn here by default. */
  readonly newId?: () => string;
  readonly timeoutMs?: number;
}

/**
 * `checkFolder(path)`: seals `{ path }`, sends `folder.check`, and waits
 * for its own `folder.checked` (opened, then read with `zFolderCheckResult`;
 * one that does not open or read is dropped with a warning, never shown) or
 * `folder.error` (`runner-offline`), `timeout` after 10 s or without a socket.
 * Throws when the vault is locked.
 */
export const createFolderCheck =
  ({ socket, vault, newId = () => uuidv7(), timeoutMs = FOLDER_CHECK_TIMEOUT_MS }: FolderCheckOptions) =>
  async (path: string): Promise<FolderCheckOutcome> => {
    const requestId = newId();
    const sealed = toWire(await vault.sealItem(utf8(JSON.stringify({ path })), utf8(folderCheckAad(requestId))));

    const open = async (item: WireSealedItem): Promise<FolderCheckResult | null> => {
      try {
        const plaintext = await vault.openItem({ key: fromBase64Url(item.key), ciphertext: fromBase64Url(item.ciphertext) }, utf8(folderCheckedAad(requestId)));
        return zFolderCheckResult.parse(JSON.parse(decoder.decode(plaintext)));
      } catch {
        console.warn('folder check: an answer that does not open was dropped', requestId);
        return null;
      }
    };

    return new Promise<FolderCheckOutcome>((resolve) => {
      let done = false;
      const finish = (outcome: FolderCheckOutcome) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        stop();
        resolve(outcome);
      };
      const timer = setTimeout(() => finish(TIMEOUT), timeoutMs);
      const stop = socket.onFolder((message) => {
        if (message.requestId !== requestId || done) return;
        if (message.type === 'folder.error') return finish(OFFLINE);
        void open(message.sealed).then((result) => {
          if (result) finish(result);
        });
      });
      if (!socket.sendFolder({ type: 'folder.check', requestId, sealed })) finish(TIMEOUT);
    });
  };

/** The form's line of the check, and the Runner's result while it is one a Projet can be created from. */
export interface FolderCheckerState {
  /** The path as typed last. */
  readonly path: string;
  readonly check: { readonly state: FolderFormCheckState; readonly hasCode: boolean };
  /** The Runner's answer for `path`, `null` while none (idle, checking, offline, timeout). */
  readonly result: FolderCheckResult | null;
}

export interface FolderChecker {
  /** A keystroke: `checking` at once, the check sent 400 ms after the last one; an empty path is `idle`. */
  type(path: string): void;
  state(): FolderCheckerState;
  /** Forgets the path and any check on its way. */
  reset(): void;
  subscribe(fn: () => void): () => void;
}

const IDLE: FolderCheckerState = { path: '', check: { state: 'idle', hasCode: false }, result: null };

/** The checks of a path being typed: debounced, the last request winning (an earlier answer arriving late is dropped). */
export const createFolderChecker = ({
  check,
  debounceMs = FOLDER_CHECK_DEBOUNCE_MS,
}: {
  readonly check: (path: string) => Promise<FolderCheckOutcome>;
  readonly debounceMs?: number;
}): FolderChecker => {
  let state = IDLE;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const set = (next: FolderCheckerState) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const run = async (path: string, asked: number) => {
    const outcome = await check(path).catch(() => null);
    if (asked !== generation) return;
    if (outcome === null) return set({ path, check: IDLE.check, result: null });
    const result = outcome.state === 'runner-offline' || outcome.state === 'timeout' ? null : (outcome as FolderCheckResult);
    set({ path, check: { state: outcome.state, hasCode: result?.hasCode ?? false }, result });
  };

  return {
    type(path) {
      generation += 1;
      clearTimeout(timer);
      if (path.trim() === '') return set({ ...IDLE, path });
      const asked = generation;
      set({ path, check: { state: 'checking', hasCode: false }, result: null });
      timer = setTimeout(() => void run(path, asked), debounceMs);
    },
    state: () => state,
    reset() {
      generation += 1;
      clearTimeout(timer);
      set(IDLE);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
