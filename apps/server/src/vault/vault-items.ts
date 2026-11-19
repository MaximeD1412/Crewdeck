import { ideaItemAad, processSealAad, type VaultItem, worktreeCommandsAad, zSealedItem } from '@crewdeck/contracts';
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
  /** Replaces the key of item `itemId`, its ciphertext kept; `false` when it holds none. */
  replace(tx: Tx, itemId: string, wrappedKey: string): Promise<boolean>;
}

/** A sealed item stored as received (`{ key, ciphertext }`), its key replaced. */
const rekeyed = (stored: unknown, wrappedKey: string): Prisma.InputJsonValue | undefined => {
  const parsed = zSealedItem.safeParse(stored);
  return parsed.success ? { key: wrappedKey, ciphertext: parsed.data.ciphertext } : undefined;
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
  async replace(tx, id, wrappedKey) {
    const row = await tx.idea.findUnique({ where: { id }, select: { [field]: true } });
    const value = rekeyed((row as Record<string, unknown> | null)?.[field], wrappedKey);
    if (!value) return false;
    await tx.idea.update({ where: { id }, data: { [field]: value } });
    return true;
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
  async replace(tx, id, wrappedKey) {
    const row = await tx.processVersion.findUnique({ where: { id }, select: { sealed: true } });
    const value = rekeyed(row?.sealed, wrappedKey);
    if (!value) return false;
    // The migration's trigger lets only this through: the same ciphertext, every other column the same.
    await tx.processVersion.update({ where: { id }, data: { sealed: value } });
    return true;
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
  async replace(tx, id, wrappedKey) {
    const row = await tx.processDraft.findUnique({ where: { id }, select: { sealed: true } });
    const value = rekeyed(row?.sealed, wrappedKey);
    if (!value) return false;
    await tx.processDraft.update({ where: { id }, data: { sealed: value } });
    return true;
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
  async replace(tx, projectId, wrappedKey) {
    const row = await tx.projectSettings.findUnique({ where: { projectId }, select: { worktreeCommands: true } });
    const value = rekeyed(row?.worktreeCommands, wrappedKey);
    if (!value) return false;
    await tx.projectSettings.update({ where: { projectId }, data: { worktreeCommands: value } });
    return true;
  },
};

/** The kinds of every sealed item the server stores today. */
export const VAULT_ITEM_KINDS: readonly VaultItemKind[] = [ideaKind('text'), ideaKind('analysis'), ideaKind('reason'), processVersions, processDrafts, worktreeCommands];

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
