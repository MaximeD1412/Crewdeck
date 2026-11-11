import type { Bytes } from './bytes.js';

/**
 * This browser's Appareil (ADR 0003): its X25519 key pair, the private key a
 * non-extractable `CryptoKey` that IndexedDB keeps as is (structured clone),
 * and the id the server gave it once a link code named it (`null` before).
 */
export interface StoredDevice {
  readonly deviceId: string | null;
  readonly privateKey: CryptoKey;
  readonly publicKey: Bytes;
}

export interface DeviceStore {
  getDevice(): Promise<StoredDevice | null>;
  saveDevice(device: StoredDevice): Promise<void>;
  clearDevice(): Promise<void>;
}

const DATABASE = 'crewdeck-keys';
const STORE = 'device';
/** One Appareil per browser profile: one record. */
const KEY = 'self';

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'));
  });

const open = (factory: IDBFactory): Promise<IDBDatabase> => {
  const request = factory.open(DATABASE, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  return done(request);
};

/** The Appareil in IndexedDB's database `crewdeck-keys`, store `device`. */
export const createDeviceStore = (factory?: IDBFactory): DeviceStore => {
  let database: Promise<IDBDatabase> | null = null;
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    database ??= open(factory ?? indexedDB);
    const transaction = (await database).transaction(STORE, mode);
    const committed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB'));
    });
    const [result] = await Promise.all([done(fn(transaction.objectStore(STORE))), committed]);
    return result;
  };
  return {
    async getDevice() {
      const stored = (await run('readonly', (store) => store.get(KEY))) as StoredDevice | undefined;
      return stored ?? null;
    },
    async saveDevice(device) {
      await run('readwrite', (store) => store.put({ deviceId: device.deviceId, privateKey: device.privateKey, publicKey: device.publicKey }, KEY));
    },
    async clearDevice() {
      await run('readwrite', (store) => store.delete(KEY));
    },
  };
};
