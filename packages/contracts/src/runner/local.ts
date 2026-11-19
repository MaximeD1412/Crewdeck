import { z } from 'zod';
import { zBranchPrefix, zCodeChangeState, zSourceNumber, zTicketState, zTicketStateReason } from '../api/tickets.js';
import { zSha } from '../github/index.js';
import { zBytes, zVaultKeyVersion } from '../keys/pairing.js';
import { type SealedItem, zSealedItem } from '../keys/sealed.js';
import { zDay, zId, zInstant } from '../values.js';
import { runnerMessage } from './envelope.js';

/**
 * What the Runner reports of a Local Projet's folder (SOURCE-3, ADR 0012,
 * « What the server keeps of a Local Projet »): the Tickets of `tickets/`,
 * the milestones of `tickets/milestones.yml`, the changes of code of
 * local.db, as the same rows as GitHub's, every free text sealed by the
 * Runner under the vault key (`localTextAad`). Nothing of a body, a comment,
 * a file's path or name in clear (ADR 0003).
 */

/** The labels of a Local Ticket the server reads (BOUCLE-1): `priority:*`, `size:*`, `ready-for-agent`, `needs-human`; any other is sealed. */
export const LOCAL_READABLE_LABEL = /^(priority:.+|size:.+|ready-for-agent|needs-human)$/;

/** At most this many items, and unreadable files, in one `local.changed`. */
export const LOCAL_ITEMS_MAX = 20_000;

/** At most this many blockers of one Ticket. */
export const LOCAL_BLOCKED_BY_MAX = 500;

/**
 * The additional data of a Local Projet's sealed text: `local:<projectId>:`
 * and what it is (`ticket:12:title`, `ticket:12:labels`, `milestone:2:title`,
 * `change:31:title`, `unreadable:<key>:path`), so that a text never opens in
 * another place.
 */
export const localTextAad = (projectId: string, place: string): string => `local:${projectId}:${place}`;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * A sealed text as one flat param of a Décision (`params` hold no object):
 * `<key>.<ciphertext>`, both base64url (`ticket.local-unreadable`'s path).
 */
export const localSealedParam = (sealed: SealedItem): string => `${sealed.key}.${sealed.ciphertext}`;

/** The sealed text of a `localSealedParam`; null for any other value. */
export const localSealedOfParam = (value: unknown): SealedItem | null => {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [key = '', ciphertext = ''] = parts;
  return BASE64URL.test(key) && BASE64URL.test(ciphertext) ? { key, ciphertext } : null;
};

/**
 * A Ticket, its file readable: its title sealed (`ticket:<n>:title`), its
 * product labels readable and the others one sealed JSON array
 * (`ticket:<n>:labels`, null when none), the figures the Boucle needs from
 * them (`branchPrefix` from `type:*`, `visualReview` from `revue-visuelle`),
 * its milestone by rank, its content hash (`ContentHash`), and `observedAt`
 * the file's modification time, or the time the Runner wrote it.
 */
export const zLocalTicketItem = z.strictObject({
  kind: z.literal('ticket'),
  number: zSourceNumber,
  state: zTicketState,
  stateReason: zTicketStateReason.nullable(),
  readyMark: z.boolean(),
  labels: z.array(z.string().regex(LOCAL_READABLE_LABEL)).max(100),
  labelsSealed: zSealedItem.nullable(),
  branchPrefix: zBranchPrefix,
  visualReview: z.boolean(),
  titleSealed: zSealedItem,
  milestoneRank: zSourceNumber.nullable(),
  blockedBy: z.array(zSourceNumber).max(LOCAL_BLOCKED_BY_MAX),
  parent: zSourceNumber.nullable(),
  contentHash: z.string().regex(/^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$/),
  createdAt: zInstant,
  updatedAt: zInstant,
  closedAt: zInstant.nullable(),
  observedAt: zInstant,
});
export type LocalTicketItem = z.infer<typeof zLocalTicketItem>;

/** A Ticket whose file is gone (or no longer readable). */
export const zLocalTicketRemovedItem = z.strictObject({ kind: z.literal('ticket-removed'), number: zSourceNumber, observedAt: zInstant });
export type LocalTicketRemovedItem = z.infer<typeof zLocalTicketRemovedItem>;

/** A milestone, named by its rank in `tickets/milestones.yml` (from 1), its title sealed (`milestone:<rank>:title`). */
export const zLocalMilestoneItem = z.strictObject({
  kind: z.literal('milestone'),
  rank: zSourceNumber,
  titleSealed: zSealedItem,
  // A day, `YYYY-MM-DD`, read as a string in Go (go-jsonschema's date type is not a dependency of the Runner).
  dueOn: zDay.nullable().meta({ goJSONSchema: { type: '*string' } }),
  observedAt: zInstant,
});
export type LocalMilestoneItem = z.infer<typeof zLocalMilestoneItem>;

/** A milestone no longer in `tickets/milestones.yml`. */
export const zLocalMilestoneRemovedItem = z.strictObject({ kind: z.literal('milestone-removed'), rank: zSourceNumber });
export type LocalMilestoneRemovedItem = z.infer<typeof zLocalMilestoneRemovedItem>;

/**
 * A change of code of local.db, its title sealed (`change:<n>:title`), the
 * Ticket it delivers from its head branch (`<feat|fix|chore>/<n>-…`), never
 * the branch's name: its slug is the Ticket's title.
 */
export const zLocalChangeItem = z.strictObject({
  kind: z.literal('change'),
  number: zSourceNumber,
  ticketNumber: zSourceNumber.nullable(),
  titleSealed: zSealedItem,
  state: zCodeChangeState,
  baseRef: z.string().min(1).max(255),
  headSha: zSha.nullable(),
  mergeSha: zSha.nullable(),
  createdAt: zInstant,
  updatedAt: zInstant,
  mergedAt: zInstant.nullable(),
  closedAt: zInstant.nullable(),
  observedAt: zInstant,
});
export type LocalChangeItem = z.infer<typeof zLocalChangeItem>;

export const LOCAL_ITEM_KINDS = ['ticket', 'ticket-removed', 'milestone', 'milestone-removed', 'change'] as const;
export const zLocalItemUnion = z.discriminatedUnion('kind', [zLocalTicketItem, zLocalTicketRemovedItem, zLocalMilestoneItem, zLocalMilestoneRemovedItem, zLocalChangeItem]);
/** `goJSONSchema`: the Go union `contracts.LocalItem` that `contracts:generate` writes (registry's `goUnions`). */
export const zLocalItem = zLocalItemUnion.meta({ goJSONSchema: { type: 'LocalItem' } });
export type LocalItem = z.infer<typeof zLocalItem>;

/** Why a file of `tickets/` is not a Ticket: its front matter (or milestones.yml) does not parse, or another file has its number. */
export const LOCAL_UNREADABLE_REASONS = ['front-matter', 'duplicate-number'] as const;
export const zLocalUnreadableReason = z.enum(LOCAL_UNREADABLE_REASONS);
export type LocalUnreadableReason = z.infer<typeof zLocalUnreadableReason>;

/**
 * A file of `tickets/` the Runner could not read: `key` the base64url of 16
 * bytes of HMAC(`DeriveKey("crewdeck/v1/path-key")`, its path from the
 * folder), its path sealed (`unreadable:<key>:path`).
 */
export const zLocalUnreadable = z.strictObject({
  key: zBytes(16, 16),
  reason: zLocalUnreadableReason,
  pathSealed: zSealedItem,
});
export type LocalUnreadable = z.infer<typeof zLocalUnreadable>;

/**
 * Runner → server: what changed in a Local Projet's folder since its last
 * report (`full: false`), or every item (`full: true`, once per Local Projet
 * on each accepted connection: a row absent from it is gone). `unreadable` is
 * always the Projet's whole current set. `vaultKeyVersion` is the version
 * its texts are sealed under: the server writes nothing of a report sealed
 * under another than the vault's current one (a rotation since), and the
 * Runner reports every item again once it holds the new one.
 */
export const zLocalChanged = runnerMessage('local.changed', {
  projectId: zId,
  vaultKeyVersion: zVaultKeyVersion,
  full: z.boolean(),
  items: z.array(zLocalItem).max(LOCAL_ITEMS_MAX),
  unreadable: z.array(zLocalUnreadable).max(LOCAL_ITEMS_MAX),
});
export type LocalChanged = z.infer<typeof zLocalChanged>;
