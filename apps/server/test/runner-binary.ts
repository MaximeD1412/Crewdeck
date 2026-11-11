import { execFile } from 'node:child_process';
import type { webcrypto } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type {
  ApproveDevice,
  BrowserPairing,
  ConfirmPairing,
  Device,
  DeviceApproval,
  DeviceCreated,
  NewDeviceRequest,
  PendingDevice,
  RunnerPairing,
  VaultKeyWrap,
} from '@crewdeck/contracts';

/**
 * What the integration tests of the real Go Runner share (E2E-2, E2E-3): the
 * binary built from apps/runner, the web's own keys (apps/web/src/keys/,
 * WebCrypto in Node) and a proxy that records every request. Needs `go` on the
 * PATH (CI's setup installs it with mise).
 */

export const run = promisify(execFile);

export const ROOT = resolve(import.meta.dirname, '../../..');
export const RUNNER_DIR = join(ROOT, 'apps/runner');

/** Builds `crewdeck-runner` into `work`, with the fake Moteur the link finds on the PATH. */
export const buildRunner = async (work: string): Promise<string> => {
  const binaryPath = join(work, 'crewdeck-runner');
  await run('go', ['build', '-o', binaryPath, './cmd/crewdeck-runner'], { cwd: RUNNER_DIR });
  await writeFile(join(work, 'claude'), '#!/bin/sh\necho "claude (fake)"\n');
  await chmod(join(work, 'claude'), 0o755);
  return binaryPath;
};

// The web's keys, as its page runs them. Imported by a computed path: the
// server's code never depends on the web's (the module boundaries), only these
// tests do.
export interface StoredDevice {
  readonly deviceId: string | null;
  readonly privateKey: webcrypto.CryptoKey;
  readonly publicKey: Uint8Array;
  readonly senderPublicKey?: Uint8Array;
}
export interface DeviceStore {
  getDevice(): Promise<StoredDevice | null>;
  saveDevice(device: StoredDevice): Promise<void>;
  clearDevice(): Promise<void>;
}
export interface SealedItem {
  readonly key: Uint8Array;
  readonly ciphertext: Uint8Array;
}
export interface Vault {
  state(): string;
  version(): number | null;
  unlockVault(): Promise<string>;
  sealItem(plaintext: Uint8Array, aad: Uint8Array): Promise<SealedItem>;
  openItem(item: SealedItem, aad: Uint8Array): Promise<Uint8Array>;
  rawVaultKeyForWrap(): Promise<Uint8Array>;
}
export interface LinkKeys {
  browserPairing(): Promise<BrowserPairing>;
  adoptDevice(deviceId: string): Promise<void>;
  confirmPairing(link: { secret: string; shortId: string; runnerId: string; runnerPairing: RunnerPairing }): Promise<ConfirmPairing | null>;
}
export interface DeviceCode {
  readonly shortId: string;
  readonly secret: string;
}
export interface NewDeviceCode extends DeviceCode {
  readonly id: string;
  readonly expiresAt: string;
}
export interface ApprovalApi {
  register(request: NewDeviceRequest): Promise<DeviceCreated>;
  approval(id: string): Promise<DeviceApproval>;
  pending(shortId: string): Promise<PendingDevice>;
  approve(id: string, body: ApproveDevice): Promise<Device>;
}
export interface DeviceApprovalKeys {
  register(): Promise<NewDeviceCode>;
  adopt(code: NewDeviceCode): Promise<'approved' | 'invalid'>;
}
export interface WebKeys {
  createVault(options: { devices: DeviceStore; fetchWrap: (deviceId: string) => Promise<VaultKeyWrap> }): Vault;
  createLinkKeys(options: { devices: DeviceStore; vault: Vault; userAgent: string }): LinkKeys;
  createDeviceApproval(options: { devices: DeviceStore; vault: Vault; api: ApprovalApi; userAgent: string }): DeviceApprovalKeys;
  deviceCodeText(code: DeviceCode): string;
  encodeBase32(bytes: Uint8Array): string;
  decodeBase32(text: string): Uint8Array;
  toBase64Url(bytes: Uint8Array): string;
  fromBase64Url(text: string): Uint8Array;
}
export const webKeys = async (): Promise<WebKeys> => {
  const module = (file: string) => import(pathToFileURL(join(ROOT, 'apps/web/src/keys', file)).href);
  const parts = await Promise.all(['vault.ts', 'pairing.ts', 'approval.ts', 'base32.ts', 'bytes.ts'].map(module));
  return Object.assign({}, ...parts) as WebKeys;
};

/** The Appareil of a browser profile, in memory where the page has IndexedDB. */
export const memoryDevices = (): DeviceStore => {
  let stored: StoredDevice | null = null;
  return {
    getDevice: async () => stored,
    saveDevice: async (device) => {
      stored = device;
    },
    clearDevice: async () => {
      stored = null;
    },
  };
};

/** In front of the server, what the binary sends goes through here and is kept in `sent`, as text. */
export const recordingProxy = async (target: string, sent: string[]): Promise<{ server: Server; url: string }> => {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      sent.push(`${req.method} ${req.url} ${JSON.stringify(req.headers)} ${body}`);
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => name !== 'host' && name !== 'content-length')) as Record<string, string>;
      fetch(`${target}${req.url}`, { method: req.method, headers, ...(body ? { body } : {}) })
        .then(async (answer) => {
          const text = await answer.text();
          sent.push(`answer ${req.url} ${answer.status}`);
          res.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json' });
          res.end(text);
        })
        .catch(() => {
          res.writeHead(502);
          res.end();
        });
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('proxy without a port');
  return { server, url: `http://127.0.0.1:${address.port}` };
};
