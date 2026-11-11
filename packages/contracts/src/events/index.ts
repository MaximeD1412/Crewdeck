import { z } from 'zod';
import { zId, zInstant, zSeq } from '../values.js';

/**
 * The events of ADR 0007: what changed in the Process of one Pilote, numbered
 * by `seq`. The tables are the truth; an event tells the page which resource
 * changed, its payload being that resource as the API returns it.
 */

/** The resources an event may be about, kebab-case as the API's. */
export const RESOURCES = [
  'pilot',
  'settings',
  'runner',
  'ai-account',
  'device',
  'project',
  'repository',
  'ticket',
  'agent-loop',
  'schedule',
  'agent-session',
  'step-run',
  'decision',
  'idea',
  'design',
  'usage',
] as const;
export const zResource = z.enum(RESOURCES);
export type Resource = z.infer<typeof zResource>;

/** `<resource>.upserted` (created or changed) or `<resource>.removed`. */
export const zEventType = z.templateLiteral([zResource, z.enum(['.upserted', '.removed'])]);
export type EventType = z.infer<typeof zEventType>;

/** The payload of every `<resource>.removed`: the id of what is gone. */
export const zRemovedPayload = z.object({ id: zId });
export type RemovedPayload = z.infer<typeof zRemovedPayload>;

/**
 * The payload of each resource's `upserted`, at the type level: each module
 * adds its resource next to its API schema, with `registerEventPayload` and
 * `declare module '<this file>' { interface EventPayloads { … } }`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type -- filled by declaration merging, one resource per module
export interface EventPayloads {}

/** The payload of an event of `type`: `never` for a resource no module registered (`write` refuses it). */
export type EventPayload<T extends EventType> = T extends `${string}.removed`
  ? RemovedPayload
  : T extends `${infer R}.upserted`
    ? R extends keyof EventPayloads
      ? EventPayloads[R]
      : never
    : never;

const payloads = new Map<Resource, z.ZodType>();

/**
 * Registers the payload of `resource`'s `upserted` events: the resource as
 * the API returns it. Once per resource; returns `schema`.
 */
export const registerEventPayload = <S extends z.ZodType>(resource: Resource, schema: S): S => {
  if (payloads.has(resource)) throw new Error(`The event payload of ${resource} is already registered.`);
  payloads.set(resource, schema);
  return schema;
};

/** The schema of an event's payload, `undefined` when its resource's module registered none. */
export const eventPayloadSchema = (type: EventType): z.ZodType | undefined => {
  const [resource, verb] = type.split('.') as [Resource, 'upserted' | 'removed'];
  return verb === 'removed' ? zRemovedPayload : payloads.get(resource);
};

/**
 * One event as the socket carries it (`event { event }`); its payload checked
 * against the schema of its type. `sourceAt`: when its source saw the change
 * (a webhook's delivery, a Runner's report), for the latency of US-20.
 */
export const zEvent = z
  .object({
    seq: zSeq,
    type: zEventType,
    payload: z.unknown(),
    at: zInstant,
    sourceAt: zInstant.optional(),
  })
  .superRefine((event, ctx) => {
    const schema = eventPayloadSchema(event.type);
    if (!schema) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: `Aucun contenu n’est défini pour ${event.type}.` });
      return;
    }
    for (const issue of schema.safeParse(event.payload).error?.issues ?? []) {
      ctx.addIssue({ ...issue, path: ['payload', ...issue.path] } as Parameters<typeof ctx.addIssue>[0]);
    }
  });
export type Event = z.infer<typeof zEvent>;
