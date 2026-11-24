import { type AttachProjectFolder, type CreateLocalProject, type Project, type SealedItem, zAttachProjectFolder, zCreateLocalProject, zId, zProject } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Injectable, Param, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError, notFound, unprocessable } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProcessService } from '../../process/process.service.js';
import { SourcesService } from '../../process/sources/sources.service.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { assertFresh } from '../../realtime/freshness.js';
import { Transactions } from '../../realtime/transactions.js';
import { RunnerCommands } from '../../runners/runner-commands.service.js';
import { RunnerPresence } from '../../runners/runner-presence.service.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { assertVaultVersion } from '../../vault/sealed-write.js';
import { ProjectChanges } from '../project-changes.js';
import { inventoryStateRow, PROJECT_VIEW, toProject } from '../project.view.js';

export class CreateLocalProjectDto extends createZodDto(zCreateLocalProject) {}
export class AttachProjectFolderDto extends createZodDto(zAttachProjectFolder) {}
export class LocalProjectDto extends createZodDto(zProject) {}

/** Without a folder's branch (no git): the release branch a Local Projet starts with. */
const DEFAULT_RELEASE_BRANCH = 'main';

const projectNotFound = (): AppError => notFound('project.not-found', MESSAGES['project.not-found']);
const runnerOffline = (): AppError => unprocessable('runner.offline', MESSAGES['runner.offline']);
const idTaken = (): AppError => unprocessable('project.id-taken', MESSAGES['project.id-taken']);
const notLocal = (): AppError => unprocessable('project.not-local', MESSAGES['project.not-local']);

/** The primary key refused the row: the id the page drew is already a Projet's, maybe another Pilote's. */
const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * The Local Projets (PROJET-6, ADR 0012): a Projet from a folder of the
 * Runner's machine. The server keeps what a GitHub Projet has, but no
 * repository, its name sealed under the vault key (`project:<id>:name`)
 * and only whether its folder is there; the path goes to the Runner sealed
 * (`project:<id>:folder`), which keeps it and says which Projets still
 * have theirs (`ProjectFolders`).
 */
@Injectable()
export class LocalProjects {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly process: ProcessService,
    private readonly sources: SourcesService,
    private readonly changes: ProjectChanges,
    private readonly presence: RunnerPresence,
    private readonly commands: RunnerCommands,
    @InjectPinoLogger(LocalProjects.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * 422 `runner.offline` first (the Runner checked the folder and must store
   * it), 422 `project.id-taken` for an id already a Projet's, 409
   * `vault.version-changed` for a name and a folder sealed under another
   * vault key than the current one. One
   * transaction: the row (folder `pending`), its Sources (every group
   * Local), its Process from `templateId`, `project.upserted`. Then the
   * folder to the Runner; a send that fails leaves it `pending`.
   */
  async create(pilotId: string, input: CreateLocalProject): Promise<Project> {
    if (!this.presence.isOnline(pilotId)) throw runnerOffline();
    let project: Project;
    try {
      project = await this.transactions.run(async (tx) => {
        // The Pilote's row held: no rotation moves the vault before the commit.
        await this.events.lock(tx, pilotId);
        await assertVaultVersion(tx, pilotId, input.vaultKeyVersion);
        const row = await tx.project.create({
          data: {
            id: input.id,
            pilotId,
            nameSealed: input.nameSealed as unknown as Prisma.InputJsonValue,
            folderState: 'pending',
            integrationBranch: 'develop',
            releaseBranch: input.releaseBranch ?? DEFAULT_RELEASE_BRANCH,
            hasCode: input.hasCode,
            inventoryState: inventoryStateRow(input.hasCode ? 'pending' : 'not-needed'),
          },
          select: PROJECT_VIEW,
        });
        const view = toProject(row);
        const seq = await this.events.write(tx, pilotId, 'project.upserted', view);
        await tx.project.update({ where: { id: input.id }, data: { lastSeq: seq } });
        // Its Sources first, so that its first process.upserted holds them: a folder, every group Local.
        await this.sources.createDefaults(tx, input.id, 'local');
        await this.process.createInitialVersion(tx, input.id, { template: input.templateId, sealed: input.templateSealed });
        return view;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw idTaken();
      throw error;
    }
    this.changes.changed(pilotId);
    this.attachOnRunner(pilotId, input.id, input.folderSealed);
    return project;
  }

  /**
   * The folder of a Local Projet chosen again (its Décision
   * `project.folder-missing`): 404 `project.not-found`, 422
   * `project.not-local` for a GitHub Projet, 422 `runner.offline`, 409
   * `realtime.stale`, 409 `vault.version-changed` for a folder sealed under
   * another vault key; the folder `pending`, then to the Runner.
   */
  async attach(pilotId: string, id: string, { folderSealed, vaultKeyVersion, seq }: AttachProjectFolder): Promise<Project> {
    const found = await this.prisma.scoped.project.findUnique({ where: { id }, select: { folderState: true } });
    if (!found) throw projectNotFound();
    if (found.folderState === null) throw notLocal();
    if (!this.presence.isOnline(pilotId)) throw runnerOffline();
    const project = await this.transactions.run(async (tx) => {
      await this.events.lock(tx, pilotId);
      const current = await tx.project.findUnique({ where: { id }, select: { lastSeq: true } });
      if (!current) throw projectNotFound();
      assertFresh(current.lastSeq, BigInt(seq));
      await assertVaultVersion(tx, pilotId, vaultKeyVersion);
      const view = toProject(await tx.project.update({ where: { id }, data: { folderState: 'pending' }, select: PROJECT_VIEW }));
      const projectSeq = await this.events.write(tx, pilotId, 'project.upserted', view);
      await tx.project.update({ where: { id }, data: { lastSeq: projectSeq } });
      return view;
    });
    this.attachOnRunner(pilotId, id, folderSealed);
    return project;
  }

  private attachOnRunner(pilotId: string, projectId: string, sealed: SealedItem): void {
    try {
      this.commands.send(pilotId, { type: 'project.folder.attach', projectId, sealed });
    } catch (error) {
      // Gone offline since the check: the folder stays pending until it is chosen again.
      this.logger.warn({ err: error, projectId }, 'project folder not sent to the runner');
    }
  }
}

const projectId = (value: string): string => {
  const parsed = zId.safeParse(value);
  if (!parsed.success) throw projectNotFound();
  return parsed.data;
};

/** `POST /api/projects/local`, `POST /api/projects/:id/folder`. */
@Controller('projects')
export class LocalProjectsController {
  constructor(private readonly projects: LocalProjects) {}

  @Post('local')
  @ZodResponse({ status: 201, description: 'The Local Projet, its folder pending until the Runner stored it.', type: LocalProjectDto })
  create(@Body() body: CreateLocalProjectDto): Promise<Project> {
    return this.projects.create(currentPilotId(), body);
  }

  @Post(':id/folder')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Local Projet, its folder pending until the Runner stored it again.', type: LocalProjectDto })
  attach(@Param('id') id: string, @Body() body: AttachProjectFolderDto): Promise<Project> {
    return this.projects.attach(currentPilotId(), projectId(id), body);
  }
}
