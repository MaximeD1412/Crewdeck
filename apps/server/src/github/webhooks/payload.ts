/**
 * A webhook's payload, as GitHub sent it: read in memory for its metadata
 * (ids, numbers, titles, states, SHAs, labels), never stored nor logged. A
 * `body`, a comment or a diff it carries stays in it (ADR 0003).
 */
export type WebhookPayload = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is WebhookPayload => typeof value === 'object' && value !== null && !Array.isArray(value);

const objectAt = (value: unknown, key: string): WebhookPayload | undefined => (isObject(value) && isObject(value[key]) ? value[key] : undefined);

const idAt = (value: unknown, key: string): number | undefined => {
  const id = isObject(value) ? value[key] : undefined;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

/** Whether a parsed body is a payload: a JSON object. */
export const isPayload = isObject;

/** `installation.id`: what the dispatcher finds the Pilote of the delivery by. */
export const installationIdOf = (payload: WebhookPayload): number | undefined => idAt(objectAt(payload, 'installation'), 'id');

/** `action`, the event's subtype (`created`, `opened`…), when it has one. */
export const actionOf = (payload: WebhookPayload): string | undefined => (typeof payload['action'] === 'string' ? payload['action'] : undefined);

/** What the installations index keeps of an `installation` event's payload. */
export interface InstallationFacts {
  readonly installationId: number;
  readonly accountLogin: string;
  readonly accountId: number;
  readonly senderId: number;
  readonly suspended: boolean;
}

/** The facts of an `installation.created`, or `undefined` when one is missing. */
export const installationFactsOf = (payload: WebhookPayload): InstallationFacts | undefined => {
  const installation = objectAt(payload, 'installation');
  const account = objectAt(installation, 'account');
  const installationId = idAt(installation, 'id');
  const accountId = idAt(account, 'id');
  const senderId = idAt(objectAt(payload, 'sender'), 'id');
  const accountLogin = account?.['login'];
  if (installationId === undefined || accountId === undefined || senderId === undefined || typeof accountLogin !== 'string') return undefined;
  return { installationId, accountLogin, accountId, senderId, suspended: installation?.['suspended_at'] != null };
};
