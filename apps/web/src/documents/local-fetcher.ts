import {
  type ArtifactKind,
  type ArtifactPlaintextOf,
  type ArtifactReadRefOf,
  ARTIFACT_TIMEOUT_SECONDS,
  type TabArtifactClientMessage,
  type TabArtifactServerMessage,
  artifactAad,
  artifactWrapAad,
  zArtifactPlaintexts,
} from '@crewdeck/contracts';
import { concat, fromBase64Url, toBase64Url, utf8 } from '../keys/bytes.js';
import { INFO, aesGcmOpen, importAesKey, openWrap } from '../keys/crypto.js';
import type { DeviceStore } from '../keys/device-store.js';
import { uuidv7 } from '../ids.js';
import { ArtifactUnavailable, type DocumentFetcher, type UnavailableReason } from './reader.js';

/** The page's socket, as the Local fetcher uses it (`Connection`'s). */
export interface ArtifactSocket {
  sendArtifact(message: TabArtifactClientMessage): boolean;
  onArtifact(listener: (message: TabArtifactServerMessage) => void): () => void;
}

type Content = Extract<TabArtifactServerMessage, { type: 'artifact.content' }>;

/** What the page waits for before `timeout` itself: the server's 30 s, and the way back. */
export const LOCAL_FETCH_TIMEOUT_MS = (ARTIFACT_TIMEOUT_SECONDS + 5) * 1000;

/** An answer that does not open, or outside its kind's shape: a failure, not an artefact absent. */
export class ArtifactOpenError extends Error {
  constructor() {
    super('artifact: the answer does not open');
    this.name = 'ArtifactOpenError';
  }
}

/**
 * The Local fetcher (SOURCE-4, `docs/security/e2e.md` « Contenu lu par la
 * page »): `artifact.read` on the tab's socket, named for this Appareil
 * (`holderId` its public key); the Runner's `artifact.content` opens with
 * its private key, from the Runner's public key it authenticated at pairing
 * (never one the server hands over); an `artifact.error` rejects with its
 * code. No socket open: `runner-offline`, the Runner is out of reach.
 */
export const createLocalFetcher = ({
  socket,
  devices,
  newId = () => uuidv7(),
  timeoutMs = LOCAL_FETCH_TIMEOUT_MS,
}: {
  socket: ArtifactSocket;
  devices: Pick<DeviceStore, 'getDevice'>;
  newId?: () => string;
  timeoutMs?: number;
}): DocumentFetcher => ({
  async fetch<K extends ArtifactKind>(projectId: string, kind: K, ref: ArtifactReadRefOf<K>): Promise<ArtifactPlaintextOf<K>> {
    const device = await devices.getDevice();
    // An Appareil not paired with the Runner: nothing would be sealed for it.
    if (!device?.runnerPublicKey) throw new ArtifactUnavailable('untrusted-device');
    const { privateKey, runnerPublicKey } = device;
    const holderId = toBase64Url(device.publicKey);
    const requestId = newId();

    const answer = await new Promise<Content>((resolve, reject) => {
      const done = (): void => {
        stop();
        clearTimeout(timer);
      };
      const stop = socket.onArtifact((message) => {
        if (message.requestId !== requestId) return;
        done();
        if (message.type === 'artifact.error') reject(new ArtifactUnavailable(message.code.slice('artifact.'.length) as UnavailableReason));
        else resolve(message);
      });
      const timer = setTimeout(() => {
        done();
        reject(new ArtifactUnavailable('timeout'));
      }, timeoutMs);
      if (!socket.sendArtifact({ type: 'artifact.read', requestId, projectId, holderId, kind, ref })) {
        done();
        reject(new ArtifactUnavailable('runner-offline'));
      }
    });

    if (answer.wrap.holderId !== holderId) throw new ArtifactOpenError();
    let plain: Uint8Array;
    try {
      const raw = await openWrap(
        privateKey,
        runnerPublicKey,
        { enc: fromBase64Url(answer.wrap.enc), ciphertext: fromBase64Url(answer.wrap.wrappedKey), tag: fromBase64Url(answer.wrap.tag) },
        INFO.sessionKey,
        utf8(artifactWrapAad(requestId, holderId)),
      );
      let key: CryptoKey;
      try {
        key = await importAesKey(raw);
      } finally {
        raw.fill(0);
      }
      plain = await aesGcmOpen(key, concat(fromBase64Url(answer.nonce), fromBase64Url(answer.ciphertext)), utf8(artifactAad(requestId)));
    } catch {
      throw new ArtifactOpenError();
    }
    const parsed = zArtifactPlaintexts[kind].safeParse(parseJson(new TextDecoder().decode(plain)));
    if (!parsed.success) throw new ArtifactOpenError();
    return parsed.data as ArtifactPlaintextOf<K>;
  },
});

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
