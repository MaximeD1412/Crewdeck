import { z } from 'zod';
import { zId } from '../values.js';

/**
 * What of a Projet waits for the Runner (ATOI-3): a Ticket in progress or
 * interrupted (`number`), Tickets ready, Idées to analyse or Étapes queued
 * (`count`; a queued Étape of a Ticket, its `number`). Readable state only
 * (ADR 0003): ids, numbers and counts, never a title.
 */
export const WAITING_ITEM_KINDS = ['ticket-in-progress', 'tickets-ready', 'ticket-interrupted', 'ideas-waiting', 'step-queued'] as const;
export const zWaitingItemKind = z.enum(WAITING_ITEM_KINDS);
export type WaitingItemKind = z.infer<typeof zWaitingItemKind>;

export const zWaitingItem = z.strictObject({
  kind: zWaitingItemKind,
  number: z.int().positive().optional(),
  count: z.int().positive().optional(),
});
export type WaitingItem = z.infer<typeof zWaitingItem>;

/**
 * A Projet whose work waits for the Runner, as the modules that have work
 * for it declare it (`RunnerWaitingWork`): `projectId` `null` is « Idées »,
 * the Idées not yet in a Projet. The `projects` param of the « Runner hors
 * ligne » Décision is the JSON of a list of them.
 */
export const zWaitingProject = z.strictObject({
  projectId: zId.nullable(),
  name: z.string().min(1),
  items: z.array(zWaitingItem),
});
export type WaitingProject = z.infer<typeof zWaitingProject>;

const zWaitingProjects = z.array(zWaitingProject);

/** The `projects` param of a « Runner hors ligne » Décision: none when it is not the JSON of a list of `WaitingProject`. */
export const parseWaitingProjects = (param: unknown): WaitingProject[] => {
  if (typeof param !== 'string') return [];
  try {
    const parsed = zWaitingProjects.safeParse(JSON.parse(param));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};
