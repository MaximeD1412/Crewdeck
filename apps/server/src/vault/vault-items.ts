import { ideaItemAad, localSealedOfParam, localSealedParam, localTextAad, processSealAad, projectNameAad, type VaultItem, worktreeCommandsAad, zSealedItem } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { Tx } from '../realtime/transactions.js';

/**
 * A kind of stored item under the vault key (E2E-4, `docs/security/e2e.md`
 * « The rotation »): how it lists its item keys, by id, and replaces one. Its
 * ciphertext never changes, only its key under the vault key. A ticket that
 * stores a new kind of sealed item registers it here, else a rotation would
 * leave it under a key no holder keeps.
 */
export interface VaultItemKind {
  readonly itemType: string;
  /** Its items whose id is after `after`, by id, at most `take`, in the transaction's scope. */
  list(tx: Tx, after: string | null, take: number): Promise<VaultItem[]>;
  /**
   * Replaces the key of item `itemId` with `wrappedKey`, its ciphertext kept,
   * only while its stored key is `previousKey`: `missing` when it holds none,
   * `changed` when it was written again since the rotating holder read it.
   */
  replace(tx: Tx, itemId: string, previousKey: string, wrappedKey: string): Promise<Replaced>;
}

export type Replaced = 'replaced' | 'missing' | 'changed';

/**
 * The compare and swap of an item key: `write` updates the row only where
 * the column still equals `stored` (a conditional UPDATE, which PostgreSQL
 * evaluates again on the row a concurrent write left), and answers how many
 * rows it updated.
 */
const swap = async (
  stored: unknown,
  previousKey: string,
  wrappedKey: string,
  write: (stored: Prisma.InputJsonValue, value: Prisma.InputJsonValue) => Promise<number>,
): Promise<Replaced> => {
  const parsed = zSealedItem.safeParse(stored);
  if (!parsed.success) return 'missing';
  if (parsed.data.key !== previousKey) return 'changed';
  const updated = await write(parsed.data, { key: wrappedKey, ciphertext: parsed.data.ciphertext });
  return updated === 1 ? 'replaced' : 'changed';
};

const keyOf = (stored: unknown): string | undefined => {
  const parsed = zSealedItem.safeParse(stored);
  return parsed.success ? parsed.data.key : undefined;
};

const after = (id: string | null) => (id ? { id: { gt: id } } : {});

type IdeaField = 'text' | 'analysis' | 'reason';

const ideaKind = (field: IdeaField): VaultItemKind => ({
  itemType: `idea.${field}`,
  async list(tx, from, take) {
    const rows = await tx.idea.findMany({
      where: { ...after(from), [field]: { not: Prisma.DbNull } },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, [field]: true },
    });
    return rows.flatMap((row) => {
      const wrappedKey = keyOf((row as Record<string, unknown>)[field]);
      return wrappedKey ? [{ itemType: `idea.${field}`, itemId: row.id, aad: ideaItemAad(row.id, field), wrappedKey }] : [];
    });
  },
  async replace(tx, id, previousKey, wrappedKey) {
    const row = await tx.idea.findUnique({ where: { id }, select: { [field]: true } });
    return swap((row as Record<string, unknown> | null)?.[field], previousKey, wrappedKey, async (stored, value) => {
      return (await tx.idea.updateMany({ where: { id, [field]: { equals: stored } }, data: { [field]: value } })).count;
    });
  },
});

const processVersions: VaultItemKind = {
  itemType: 'process-version.sealed',
  async list(tx, from, take) {
    const rows = await tx.processVersion.findMany({ where: { ...after(from), sealed: { not: Prisma.DbNull } }, orderBy: { id: 'asc' }, take, select: { id: true, projectId: true, sealed: true } });
    return rows.flatMap(({ id, projectId, sealed }) => {
      const wrappedKey = keyOf(sealed);
      return wrappedKey ? [{ itemType: 'process-version.sealed', itemId: id, aad: processSealAad(projectId), wrappedKey }] : [];
    });
  },
  async replace(tx, id, previousKey, wrappedKey) {
    const row = await tx.processVersion.findUnique({ where: { id }, select: { sealed: true } });
    // The migration's trigger lets only this through: the same ciphertext, every other column the same.
    return swap(row?.sealed, previousKey, wrappedKey, async (stored, value) => (await tx.processVersion.updateMany({ where: { id, sealed: { equals: stored } }, data: { sealed: value } })).count);
  },
};

const processDrafts: VaultItemKind = {
  itemType: 'process-draft.sealed',
  async list(tx, from, take) {
    const rows = await tx.processDraft.findMany({ where: { ...after(from), sealed: { not: Prisma.DbNull } }, orderBy: { id: 'asc' }, take, select: { id: true, projectId: true, sealed: true } });
    return rows.flatMap(({ id, projectId, sealed }) => {
      const wrappedKey = keyOf(sealed);
      return wrappedKey ? [{ itemType: 'process-draft.sealed', itemId: id, aad: processSealAad(projectId), wrappedKey }] : [];
    });
  },
  async replace(tx, id, previousKey, wrappedKey) {
    const row = await tx.processDraft.findUnique({ where: { id }, select: { sealed: true } });
    return swap(row?.sealed, previousKey, wrappedKey, async (stored, value) => (await tx.processDraft.updateMany({ where: { id, sealed: { equals: stored } }, data: { sealed: value } })).count);
  },
};

/** A Projet's Commandes of its worktrees (PARAM-3), its id the Projet's. */
const worktreeCommands: VaultItemKind = {
  itemType: 'project-settings.worktree-commands',
  async list(tx, from, take) {
    const rows = await tx.projectSettings.findMany({
      where: { ...(from ? { projectId: { gt: from } } : {}), worktreeCommands: { not: Prisma.DbNull } },
      orderBy: { projectId: 'asc' },
      take,
      select: { projectId: true, worktreeCommands: true },
    });
    return rows.flatMap(({ projectId, worktreeCommands: sealed }) => {
      const wrappedKey = keyOf(sealed);
      return wrappedKey ? [{ itemType: 'project-settings.worktree-commands', itemId: projectId, aad: worktreeCommandsAad(projectId), wrappedKey }] : [];
    });
  },
  async replace(tx, projectId, previousKey, wrappedKey) {
    const row = await tx.projectSettings.findUnique({ where: { projectId }, select: { worktreeCommands: true } });
    return swap(row?.worktreeCommands, previousKey, wrappedKey, async (stored, value) => {
      return (await tx.projectSettings.updateMany({ where: { projectId, worktreeCommands: { equals: stored } }, data: { worktreeCommands: value } })).count;
    });
  },
};

/** A Local Projet's name (PROJET-6), sealed by the page under `project:<id>:name`. */
const projectNames: VaultItemKind = {
  itemType: 'project.name',
  async list(tx, from, take) {
    const rows = await tx.project.findMany({ where: { ...after(from), nameSealed: { not: Prisma.DbNull } }, orderBy: { id: 'asc' }, take, select: { id: true, nameSealed: true } });
    return rows.flatMap(({ id, nameSealed }) => {
      const wrappedKey = keyOf(nameSealed);
      return wrappedKey ? [{ itemType: 'project.name', itemId: id, aad: projectNameAad(id), wrappedKey }] : [];
    });
  },
  async replace(tx, id, previousKey, wrappedKey) {
    const row = await tx.project.findUnique({ where: { id }, select: { nameSealed: true } });
    return swap(row?.nameSealed, previousKey, wrappedKey, async (stored, value) => (await tx.project.updateMany({ where: { id, nameSealed: { equals: stored } }, data: { nameSealed: value } })).count);
  },
};

/**
 * A Session's title when its artifact is Local (SOURCE-2): a copy of that
 * artifact's sealed title, rewrapped under the additional data it was sealed
 * under, which the row keeps (`title_aad`).
 */
const sessionTitles: VaultItemKind = {
  itemType: 'agent-session.title',
  async list(tx, from, take) {
    const rows = await tx.agentSession.findMany({
      where: { ...after(from), titleSealed: { not: Prisma.DbNull } },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, titleSealed: true, titleAad: true },
    });
    return rows.flatMap(({ id, titleSealed, titleAad }) => {
      const wrappedKey = keyOf(titleSealed);
      return wrappedKey && titleAad ? [{ itemType: 'agent-session.title', itemId: id, aad: titleAad, wrappedKey }] : [];
    });
  },
  async replace(tx, id, previousKey, wrappedKey) {
    const row = await tx.agentSession.findUnique({ where: { id }, select: { titleSealed: true } });
    return swap(row?.titleSealed, previousKey, wrappedKey, async (stored, value) => {
      return (await tx.agentSession.updateMany({ where: { id, titleSealed: { equals: stored } }, data: { titleSealed: value } })).count;
    });
  },
};

/** How a kind of a Local Projet's rows (SOURCE-3) reads and swaps its sealed text, the row's `number` naming its place. */
interface LocalRows {
  find(tx: Tx, after: string | null, take: number): Promise<{ id: string; projectId: string; number: number; sealed: unknown }[]>;
  read(tx: Tx, id: string): Promise<unknown>;
  write(tx: Tx, id: string, stored: Prisma.InputJsonValue, value: Prisma.InputJsonValue): Promise<number>;
}

/** A text the Runner sealed for a Local Projet's row, under `local:<projectId>:<place>` (`localTextAad`). */
const localText = (itemType: string, place: (number: number) => string, rows: LocalRows): VaultItemKind => ({
  itemType,
  async list(tx, from, take) {
    return (await rows.find(tx, from, take)).flatMap(({ id, projectId, number, sealed }) => {
      const wrappedKey = keyOf(sealed);
      return wrappedKey ? [{ itemType, itemId: id, aad: localTextAad(projectId, place(number)), wrappedKey }] : [];
    });
  },
  async replace(tx, id, previousKey, wrappedKey) {
    return swap(await rows.read(tx, id), previousKey, wrappedKey, (stored, value) => rows.write(tx, id, stored, value));
  },
});

const ticketTitles = localText('ticket.title', (number) => `ticket:${number}:title`, {
  find: async (tx, from, take) =>
    (await tx.ticket.findMany({ where: { ...after(from), titleSealed: { not: Prisma.DbNull } }, orderBy: { id: 'asc' }, take, select: { id: true, projectId: true, number: true, titleSealed: true } })).map(
      ({ titleSealed, ...row }) => ({ ...row, sealed: titleSealed }),
    ),
  read: async (tx, id) => (await tx.ticket.findUnique({ where: { id }, select: { titleSealed: true } }))?.titleSealed,
  write: async (tx, id, stored, value) => (await tx.ticket.updateMany({ where: { id, titleSealed: { equals: stored } }, data: { titleSealed: value } })).count,
});

const ticketLabels = localText('ticket.labels', (number) => `ticket:${number}:labels`, {
  find: async (tx, from, take) =>
    (await tx.ticket.findMany({ where: { ...after(from), labelsSealed: { not: Prisma.DbNull } }, orderBy: { id: 'asc' }, take, select: { id: true, projectId: true, number: true, labelsSealed: true } })).map(
      ({ labelsSealed, ...row }) => ({ ...row, sealed: labelsSealed }),
    ),
  read: async (tx, id) => (await tx.ticket.findUnique({ where: { id }, select: { labelsSealed: true } }))?.labelsSealed,
  write: async (tx, id, stored, value) => (await tx.ticket.updateMany({ where: { id, labelsSealed: { equals: stored } }, data: { labelsSealed: value } })).count,
});

/** A Local milestone's title, its number its rank. */
const milestoneTitles = localText('milestone.title', (number) => `milestone:${number}:title`, {
  find: async (tx, from, take) =>
    (await tx.milestone.findMany({ where: { ...after(from), titleSealed: { not: Prisma.DbNull } }, orderBy: { id: 'asc' }, take, select: { id: true, projectId: true, number: true, titleSealed: true } })).map(
      ({ titleSealed, ...row }) => ({ ...row, sealed: titleSealed }),
    ),
  read: async (tx, id) => (await tx.milestone.findUnique({ where: { id }, select: { titleSealed: true } }))?.titleSealed,
  write: async (tx, id, stored, value) => (await tx.milestone.updateMany({ where: { id, titleSealed: { equals: stored } }, data: { titleSealed: value } })).count,
});

const changeTitles = localText('code-change.title', (number) => `change:${number}:title`, {
  find: async (tx, from, take) =>
    (await tx.codeChange.findMany({ where: { ...after(from), titleSealed: { not: Prisma.DbNull } }, orderBy: { id: 'asc' }, take, select: { id: true, projectId: true, number: true, titleSealed: true } })).map(
      ({ titleSealed, ...row }) => ({ ...row, sealed: titleSealed }),
    ),
  read: async (tx, id) => (await tx.codeChange.findUnique({ where: { id }, select: { titleSealed: true } }))?.titleSealed,
  write: async (tx, id, stored, value) => (await tx.codeChange.updateMany({ where: { id, titleSealed: { equals: stored } }, data: { titleSealed: value } })).count,
});

const UNREADABLE = 'ticket.local-unreadable';

/**
 * The path of a Local Projet's unreadable file in its Décision (SOURCE-3),
 * open or resolved: one flat param `<key>.<ciphertext>` (`localSealedParam`),
 * sealed under `unreadable:<key>:path`, its key the end of the subject.
 */
const unreadablePaths: VaultItemKind = {
  itemType: 'decision.local-unreadable-path',
  async list(tx, from, take) {
    const rows = await tx.decision.findMany({
      where: { ...after(from), kind: UNREADABLE, projectId: { not: null }, params: { path: ['pathSealed'], string_contains: '.' } },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, projectId: true, subjectId: true, params: true },
    });
    return rows.flatMap(({ id, projectId, subjectId, params }) => {
      const sealed = localSealedOfParam((params as Record<string, unknown>)['pathSealed']);
      const prefix = `${projectId}:`;
      if (!sealed || projectId === null || !subjectId.startsWith(prefix)) return [];
      return [{ itemType: 'decision.local-unreadable-path', itemId: id, aad: localTextAad(projectId, `unreadable:${subjectId.slice(prefix.length)}:path`), wrappedKey: sealed.key }];
    });
  },
  async replace(tx, id, previousKey, wrappedKey) {
    const row = await tx.decision.findFirst({ where: { id, kind: UNREADABLE }, select: { params: true } });
    const params = (row?.params ?? {}) as Record<string, Prisma.InputJsonValue>;
    const sealed = localSealedOfParam(params['pathSealed']);
    if (!sealed) return 'missing';
    if (sealed.key !== previousKey) return 'changed';
    const value = { ...params, pathSealed: localSealedParam({ key: wrappedKey, ciphertext: sealed.ciphertext }) };
    return (await tx.decision.updateMany({ where: { id, params: { equals: params } }, data: { params: value } })).count === 1 ? 'replaced' : 'changed';
  },
};

/** The kinds of every sealed item the server stores today. */
export const VAULT_ITEM_KINDS: readonly VaultItemKind[] = [
  ideaKind('text'),
  ideaKind('analysis'),
  ideaKind('reason'),
  processVersions,
  processDrafts,
  worktreeCommands,
  projectNames,
  sessionTitles,
  ticketTitles,
  ticketLabels,
  milestoneTitles,
  changeTitles,
  unreadablePaths,
];

/** Where a page of items starts: the kind's index and the last id read. */
export interface VaultItemsCursor {
  readonly kind: number;
  readonly after: string | null;
}

/** The cursor the holder sends back as is: base64url of `<kind index>|<last id>`. */
export const encodeVaultCursor = ({ kind, after: last }: VaultItemsCursor): string => Buffer.from(`${kind}|${last ?? ''}`).toString('base64url');

export const decodeVaultCursor = (cursor: string, kinds: number): VaultItemsCursor | undefined => {
  const [kind, last, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const index = Number(kind);
  if (rest.length > 0 || last === undefined || !Number.isInteger(index) || index < 0 || index >= kinds) return undefined;
  if (last !== '' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(last)) return undefined;
  return { kind: index, after: last === '' ? null : last };
};

/**
 * The registry of the kinds of item a rotation rewraps (`VAULT_ITEM_KINDS`,
 * and a test's own): the pages of `GET /api/vault/items`, and the check that
 * a rotation brings every item exactly once.
 */
@Injectable()
export class VaultItemsRegistry {
  private readonly kinds: VaultItemKind[] = [...VAULT_ITEM_KINDS];

  /** Adds a kind; its `itemType` is unique. */
  register(kind: VaultItemKind): void {
    if (this.kinds.some(({ itemType }) => itemType === kind.itemType)) throw new Error(`The vault item kind ${kind.itemType} is already registered.`);
    this.kinds.push(kind);
  }

  kind(itemType: string): VaultItemKind | undefined {
    return this.kinds.find((kind) => kind.itemType === itemType);
  }

  get size(): number {
    return this.kinds.length;
  }

  /** At most `take` items from `cursor` on, and the cursor of the next page (`null` after the last). */
  async page(tx: Tx, cursor: VaultItemsCursor, take: number): Promise<{ items: VaultItem[]; next: VaultItemsCursor | null }> {
    const items: VaultItem[] = [];
    let { kind, after: last } = cursor;
    while (kind < this.kinds.length) {
      const read = await this.kinds[kind]!.list(tx, last, take - items.length + 1);
      const kept = read.slice(0, take - items.length);
      items.push(...kept);
      if (read.length > kept.length) return { items, next: { kind, after: kept.at(-1)?.itemId ?? last } };
      kind += 1;
      last = null;
      if (items.length === take) return { items, next: kind < this.kinds.length ? { kind, after: null } : null };
    }
    return { items, next: null };
  }

  /** Every item, each `"<itemType>:<itemId>"` to its key. */
  async all(tx: Tx): Promise<Map<string, VaultItem>> {
    const all = new Map<string, VaultItem>();
    for (const kind of this.kinds) {
      let last: string | null = null;
      for (;;) {
        const read: VaultItem[] = await kind.list(tx, last, 1000);
        for (const item of read) all.set(`${item.itemType}:${item.itemId}`, item);
        if (read.length < 1000) break;
        last = read.at(-1)!.itemId;
      }
    }
    return all;
  }
}
