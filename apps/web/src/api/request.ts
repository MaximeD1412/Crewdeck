import { DEVICE_HEADER, zErrorEnvelope, type ErrorEnvelope } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import type { z } from 'zod';

/** A failed call to the API: its envelope (ADR 0008), whose `message` the page shows as is. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Readonly<Record<string, string>> | undefined;

  constructor(envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = 'ApiError';
    this.status = envelope.status;
    this.code = envelope.code;
    this.fields = envelope.fields;
  }
}

/** What an answer that is not the API's envelope becomes (a proxy's page, a cut connection). */
const unreadable = (status: number): ErrorEnvelope => ({ status, code: 'api.unreadable', message: t('api.unreadable') });

const errorOf = async (response: Response): Promise<ApiError> => {
  const body: unknown = await response.json().catch(() => null);
  const envelope = zErrorEnvelope.safeParse(body);
  return new ApiError(envelope.success ? envelope.data : unreadable(response.status));
};

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

let currentDevice: string | null = null;

/** Names this browser's Appareil on every call from now on (`X-Crewdeck-Device`, E2E-2); `null` stops. */
export const setCurrentDevice = (deviceId: string | null): void => {
  currentDevice = deviceId;
};

/** This browser's Appareil once known: the one each page names « cet Appareil ». */
export const currentDeviceId = (): string | null => currentDevice;

let forget: (() => Promise<void>) | null = null;
let forgetting: Promise<void> | null = null;

/** What forgets this browser's Appareil once the server says it is revoked (E2E-4): `keys.forgetDevice`. */
export const onDeviceRevoked = (listener: (() => Promise<void>) | null): void => {
  forget = listener;
};

/**
 * Forgets this browser's Appareil, revoked (a 422 `devices.revoked`, the
 * socket's 4403): once for every call that learnt it at the same time, and
 * named no more even when forgetting it fails.
 */
export const deviceRevoked = (): Promise<void> => {
  forgetting ??= (forget?.() ?? Promise.resolve())
    .catch(() => undefined)
    .finally(() => {
      currentDevice = null;
      forgetting = null;
    });
  return forgetting;
};

/**
 * One call to the API on the page's origin, with its session cookie, `body`
 * sent as JSON: the answer read with `schema`, nothing for a 204 or without
 * `schema`; an `ApiError` otherwise. The page's Appareil, once known, is
 * named in `X-Crewdeck-Device`; refused as revoked (422 `devices.revoked`,
 * which the server answers before anything else), it is forgotten and the
 * call made once more without it.
 */
export async function call(method: Method, path: string, body: unknown, schema?: z.ZodType): Promise<unknown> {
  const send = (device: string | null): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (device) headers[DEVICE_HEADER] = device;
    return fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const named = currentDevice;
  let response = await send(named);
  if (!response.ok) {
    const error = await errorOf(response);
    if (!named || error.code !== 'devices.revoked') throw error;
    await deviceRevoked();
    response = await send(currentDevice);
    if (!response.ok) throw await errorOf(response);
  }
  if (!schema || response.status === 204) return undefined;
  return schema.parse(await response.json());
}

/** A call without body (the session's routes, which carry no `seq`). */
export async function request<S extends z.ZodType>(method: 'GET' | 'POST', path: string, schema: S): Promise<z.output<S>>;
export async function request(method: 'GET' | 'POST', path: string): Promise<void>;
export async function request(method: 'GET' | 'POST', path: string, schema?: z.ZodType): Promise<unknown> {
  return call(method, path, undefined, schema);
}
