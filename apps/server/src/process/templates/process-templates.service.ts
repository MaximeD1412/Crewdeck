import {
  isReservedProcessTemplateName,
  PROCESS_TEMPLATES_MAX,
  type ProcessDefinition,
  type ProcessTemplate,
  processTemplateNameKey,
  type RenameProcessTemplateInput,
  type SaveProcessTemplateInput,
  type SealedItem,
  zId,
  zProcessDefinition,
  zSealedItem,
} from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { AppError, conflict, notFound, unprocessable } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { Prisma } from '../../generated/prisma/client.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { Transactions, type Tx } from '../../realtime/transactions.js';
import { assertVaultVersion } from '../../vault/sealed-write.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { PROCESS_TEMPLATE_VIEW, toProcessTemplate } from './process-template.view.js';

const nameTaken = (): AppError => new AppError(409, 'process-template.name-taken', MESSAGES['process-template.name-taken'], { name: MESSAGES['process-template.name-taken'] });
const nameReserved = (): AppError => unprocessable('process-template.name-reserved', MESSAGES['process-template.name-reserved'], { name: MESSAGES['process-template.name-reserved'] });
const sealedMismatch = (): AppError => unprocessable('process-template.sealed-mismatch', MESSAGES['process-template.sealed-mismatch']);
export const templateNotFound = (): AppError => notFound('process-template.not-found', MESSAGES['process-template.not-found']);

/** The primary key or the name's key refused the row: a concurrent request outside the Pilote's lock, or an id another Pilote's. */
const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** The name the Pilote gave, refused when it is « Process Crewdeck » in any case. */
const checkedName = (name: string): { name: string; nameKey: string } => {
  if (isReservedProcessTemplateName(name)) throw nameReserved();
  return { name: name.trim(), nameKey: processTemplateNameKey(name) };
};

const json = (value: SealedItem | null): typeof Prisma.DbNull | Prisma.InputJsonValue => (value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue));

/** What a new Projet copies of one of the Pilote's Modèles: its definition, its sealed part, and its name for the version. */
export interface TemplateCopy {
  readonly name: string;
  readonly definition: ProcessDefinition;
  readonly sealed: SealedItem | null;
}

/**
 * Reads the Modèle `templateId` in the current Pilote's scope (`tx`) for a
 * new Projet: 404 `process-template.not-found` once it is gone (or is
 * another Pilote's); 409 `process-template.changed` when it is no longer at
 * `revision`, the one whose part the page sealed again (replaced meanwhile:
 * its definition would not be that part's); 422
 * `process-template.sealed-mismatch` when `sealed` (its part re-sealed by
 * the page for the Projet) is missing while the Modèle has one, or present
 * while it has none.
 */
export const readTemplateCopy = async (tx: Pick<Tx, 'processTemplate'>, templateId: string, revision: number | undefined, sealed: SealedItem | null): Promise<TemplateCopy> => {
  const row = await tx.processTemplate.findUnique({ where: { id: templateId }, select: { name: true, definition: true, sealed: true, revision: true } });
  if (!row) throw templateNotFound();
  if (row.revision !== revision) throw conflict('process-template.changed', MESSAGES['process-template.changed']);
  const hasSealed = zSealedItem.safeParse(row.sealed).success;
  if (hasSealed !== (sealed !== null)) throw sealedMismatch();
  return { name: row.name, definition: zProcessDefinition.parse(row.definition), sealed };
};

/**
 * The Modèles de process of the Pilote (PROCESS-14, ADR 0011): saved from a
 * Projet's active version, replaced, renamed, deleted. Each write takes the
 * Pilote's lock first, so that two names are compared in order, and writes
 * its event in its transaction (ADR 0007).
 */
@Injectable()
export class ProcessTemplatesService {
  constructor(
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
  ) {}

  /** The Pilote's Modèles, newest `updatedAt` first: the `processTemplates` slice. */
  async list(tx: Pick<Tx, 'processTemplate'>): Promise<ProcessTemplate[]> {
    const rows = await tx.processTemplate.findMany({ select: PROCESS_TEMPLATE_VIEW, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: PROCESS_TEMPLATES_MAX });
    return rows.map(toProcessTemplate);
  }

  /**
   * `POST /api/process-templates`: the active version of the Projet copied,
   * with the page's `sealed`. 422 `process-template.name-reserved`, 409
   * `vault.version-changed` for a part sealed under another vault key than
   * the current one, 404 `project.not-found`, 409 `process.version-stale`
   * when `versionNumber` is not the active one, 422 `process-template.sealed-mismatch`, 409
   * `process-template.name-taken` for a name taken without `replace` or with
   * `replace` but another id, 422 `process-template.id-taken` for an id
   * already another Modèle's, 422 `process-template.too-many` past 50.
   * `created` says whether it is new (201) or replaced one (200).
   */
  save(input: SaveProcessTemplateInput): Promise<{ template: ProcessTemplate; created: boolean }> {
    const pilotId = currentPilotId();
    const { name, nameKey } = checkedName(input.name);
    return this.transactions.run(async (tx) => {
      // The Pilote's row held: no rotation moves the vault before the commit.
      await this.events.lock(tx, pilotId);
      if (input.sealed !== null) await assertVaultVersion(tx, pilotId, input.vaultKeyVersion ?? 0);
      if ((await tx.project.count({ where: { id: input.projectId } })) === 0) throw notFound('project.not-found', MESSAGES['project.not-found']);
      const active = await tx.processVersion.findFirst({ where: { projectId: input.projectId }, orderBy: { number: 'desc' }, select: { number: true, definition: true, sealed: true } });
      if (active?.number !== input.versionNumber) throw conflict('process.version-stale', MESSAGES['process.version-stale']);
      if (zSealedItem.safeParse(active.sealed).success !== (input.sealed !== null)) throw sealedMismatch();

      const copy = {
        definition: active.definition as Prisma.InputJsonValue,
        sealed: json(input.sealed),
        fromProjectId: input.projectId,
        fromVersionNumber: active.number,
        updatedAt: new Date(),
      };
      const sameName = await tx.processTemplate.findFirst({ where: { nameKey }, select: { id: true } });
      let created: boolean;
      if (sameName) {
        if (!input.replace || sameName.id !== input.id) throw nameTaken();
        await tx.processTemplate.update({ where: { id: input.id }, data: { ...copy, name, revision: { increment: 1 } }, select: { id: true } });
        created = false;
      } else {
        if ((await tx.processTemplate.count({ where: { id: input.id } })) > 0) throw idTaken();
        if ((await tx.processTemplate.count()) >= PROCESS_TEMPLATES_MAX) throw unprocessable('process-template.too-many', MESSAGES['process-template.too-many']);
        await createRow(tx, { id: input.id, pilotId, name, nameKey, createdAt: copy.updatedAt, ...copy });
        created = true;
      }
      return { template: await this.publish(tx, pilotId, input.id), created };
    });
  }

  /** `PATCH /api/process-templates/:id`: 404 `process-template.not-found`, the name's rules of `save`; the same name changes nothing but its case. */
  rename(id: string, input: RenameProcessTemplateInput): Promise<ProcessTemplate> {
    const pilotId = currentPilotId();
    const templateId = parsedId(id);
    const { name, nameKey } = checkedName(input.name);
    return this.transactions.run(async (tx) => {
      await this.events.lock(tx, pilotId);
      if ((await tx.processTemplate.count({ where: { id: templateId } })) === 0) throw templateNotFound();
      const sameName = await tx.processTemplate.findFirst({ where: { nameKey }, select: { id: true } });
      if (sameName && sameName.id !== templateId) throw nameTaken();
      try {
        await tx.processTemplate.update({ where: { id: templateId }, data: { name, nameKey, updatedAt: new Date() }, select: { id: true } });
      } catch (error) {
        if (isUniqueViolation(error)) throw nameTaken();
        throw error;
      }
      return this.publish(tx, pilotId, templateId);
    });
  }

  /** `DELETE /api/process-templates/:id`: 404 `process-template.not-found`; the Projets started from it keep their Process (a copy). */
  remove(id: string): Promise<void> {
    const pilotId = currentPilotId();
    const templateId = parsedId(id);
    return this.transactions.run(async (tx) => {
      await this.events.lock(tx, pilotId);
      const { count } = await tx.processTemplate.deleteMany({ where: { id: templateId } });
      if (count === 0) throw templateNotFound();
      await this.events.write(tx, pilotId, 'process-template.removed', { id: templateId });
    });
  }

  private async publish(tx: Tx, pilotId: string, id: string): Promise<ProcessTemplate> {
    const row = await tx.processTemplate.findUniqueOrThrow({ where: { id }, select: PROCESS_TEMPLATE_VIEW });
    const template = toProcessTemplate(row);
    await this.events.write(tx, pilotId, 'process-template.upserted', template);
    return template;
  }
}

const idTaken = (): AppError => unprocessable('process-template.id-taken', MESSAGES['process-template.id-taken']);

/** The Modèle's id; 404 for one that is not an id. */
const parsedId = (value: string): string => {
  const parsed = zId.safeParse(value);
  if (!parsed.success) throw templateNotFound();
  return parsed.data;
};

/** Creates the row; the Pilote's row is locked, so a key refused is an id another Pilote holds (the key is global): `process-template.id-taken`. */
const createRow = async (tx: Tx, data: Prisma.ProcessTemplateUncheckedCreateInput): Promise<void> => {
  try {
    await tx.processTemplate.create({ data, select: { id: true } });
  } catch (error) {
    if (isUniqueViolation(error)) throw idTaken();
    throw error;
  }
};
