import { type FollowProjects, type Project, type ProjectList, zId, zFollowProjects, zProject, zProjectList } from '@crewdeck/contracts';
import { Body, Controller, Get, Inject, Injectable, type OnModuleInit, Param, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { Prisma } from '../generated/prisma/client.js';
import { REPOSITORY_VIEW } from '../github/repositories/repositories.js';
import { newId } from '../ids.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProcessService } from '../process/process.service.js';
import { SourcesService } from '../process/sources/sources.service.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { assertFresh } from '../realtime/freshness.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { projectNamesOf } from './project-names.js';
import { ProjectChanges } from './project-changes.js';
import { inventoryStateRow, PROJECT_VIEW, toProject } from './project.view.js';

export class FollowProjectsDto extends createZodDto(zFollowProjects) {}
export class ProjectListDto extends createZodDto(zProjectList) {}
export class ProjectDto extends createZodDto(zProject) {}

/** The Pilote's Projets (scoped by `tx`), by name. */
export const listProjects = async (tx: Pick<Tx, 'project'>): Promise<Project[]> =>
  (await tx.project.findMany({ select: PROJECT_VIEW, orderBy: [{ displayName: 'asc' }, { fullName: 'asc' }] })).map(toProject);

const repositoryNotFound = (): AppError => notFound('project.repository-not-found', MESSAGES['project.repository-not-found']);
const alreadyFollowed = (): AppError => unprocessable('project.already-followed', MESSAGES['project.already-followed']);

/** A unique index of `projects` refused the row: another command followed the repository first. */
const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * The Projets (US-3, PROJET-2): following a Dépôt GitHub makes it a Projet,
 * named after its repository, its integration branch `develop` and its
 * release branch the repository's default one (ADR 0011: no file of the
 * repository is read, the Pilote changes them in its Paramètres). One
 * transaction writes every Projet of the command, each with its Sources
 * (both groups on GitHub, SOURCE-1), its Process (version 1 of « Process
 * Crewdeck », PROCESS-3) and its `process.upserted`,
 * its `project.upserted` and its repository's `repository.upserted` (followed).
 */
@Injectable()
export class Projects {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly process: ProcessService,
    private readonly sources: SourcesService,
    private readonly changes: ProjectChanges,
  ) {}

  /**
   * 404 `project.repository-not-found` for a repository unknown or another
   * Pilote's, 422 `project.already-followed` for one already a Projet, 409
   * `realtime.stale` for one changed since `seq`. Nothing is read from GitHub;
   * the transaction checks again; two commands at once on the same
   * repository: the unique index lets one through, the other is 422.
   */
  async follow(pilotId: string, { repositoryIds, seq }: FollowProjects): Promise<Project[]> {
    const ids = [...new Set(repositoryIds)];
    if ((await this.prisma.scoped.repository.count({ where: { id: { in: ids } } })) !== ids.length) throw repositoryNotFound();
    if ((await this.prisma.scoped.project.count({ where: { repositoryId: { in: ids } } })) > 0) {
      throw alreadyFollowed();
    }
    try {
      const projects = await this.write(pilotId, ids, BigInt(seq));
      this.changes.changed(pilotId);
      return projects;
    } catch (error) {
      if (isUniqueViolation(error)) throw alreadyFollowed();
      throw error;
    }
  }

  private write(pilotId: string, ids: readonly string[], seq: bigint): Promise<Project[]> {
    return this.transactions.run(async (tx) => {
      const projects: Project[] = [];
      for (const id of ids) {
        const repository = await tx.repository.findUnique({ where: { id }, select: { ...REPOSITORY_VIEW, githubId: true, lastSeq: true } });
        if (!repository) throw repositoryNotFound();
        assertFresh(repository.lastSeq, seq);
        if ((await tx.project.count({ where: { OR: [{ repositoryId: id }, { githubRepoId: repository.githubId }] } })) > 0) {
          throw alreadyFollowed();
        }
        const projectId = newId();
        const row = await tx.project.create({
          data: {
            id: projectId,
            pilotId,
            repositoryId: id,
            githubRepoId: repository.githubId,
            owner: repository.owner,
            name: repository.name,
            fullName: repository.fullName,
            ...projectNamesOf(repository),
            hasCode: repository.hasCode,
            inventoryState: inventoryStateRow(repository.hasCode ? 'pending' : 'not-needed'),
          },
          select: PROJECT_VIEW,
        });
        const project = toProject(row);
        const projectSeq = await this.events.write(tx, pilotId, 'project.upserted', project);
        await tx.project.update({ where: { id: projectId }, data: { lastSeq: projectSeq } });
        // Its Sources first, so that its first process.upserted holds them: a Dépôt GitHub, both groups on GitHub.
        await this.sources.createDefaults(tx, projectId, 'github');
        await this.process.createInitialVersion(tx, projectId, { template: 'process-crewdeck' });
        const view = { id, owner: repository.owner, name: repository.name, fullName: repository.fullName, private: repository.private, defaultBranch: repository.defaultBranch, hasCode: repository.hasCode };
        const repositorySeq = await this.events.write(tx, pilotId, 'repository.upserted', { ...view, followed: true });
        await tx.repository.update({ where: { id }, data: { lastSeq: repositorySeq } });
        projects.push(project);
      }
      return projects;
    });
  }
}

const projectId = (value: string): string => {
  const parsed = zId.safeParse(value);
  if (!parsed.success) throw notFound('project.not-found', MESSAGES['project.not-found']);
  return parsed.data;
};

/** `POST /api/projects`, `GET /api/projects`, `GET /api/projects/:id`. */
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: Projects,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ZodResponse({ status: 201, description: 'The Projets the repositories became.', type: ProjectListDto })
  async follow(@Body() body: FollowProjectsDto): Promise<ProjectList> {
    return { items: await this.projects.follow(currentPilotId(), body) };
  }

  @Get()
  @ZodResponse({ status: 200, description: 'The Pilote’s Projets, by name.', type: ProjectListDto })
  async list(): Promise<ProjectList> {
    return { items: await listProjects(this.prisma.scoped) };
  }

  @Get(':id')
  @ZodResponse({ status: 200, description: 'One Projet.', type: ProjectDto })
  async get(@Param('id') id: string): Promise<Project> {
    const row = await this.prisma.scoped.project.findUnique({ where: { id: projectId(id) }, select: PROJECT_VIEW });
    if (!row) throw notFound('project.not-found', MESSAGES['project.not-found']);
    return toProject(row);
  }
}

/** The `projects` slice of `GET /api/state`: the same list. */
@Injectable()
export class ProjectState implements StateContributor<'projects'>, OnModuleInit {
  readonly key = 'projects';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx): Promise<Project[]> {
    return listProjects(tx);
  }
}
