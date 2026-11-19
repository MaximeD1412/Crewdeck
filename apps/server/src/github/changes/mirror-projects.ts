import { type MirrorProject, type SourceKind, zSealedItem } from '@crewdeck/contracts';
import type { PrismaService } from '../../prisma/prisma.service.js';

/** A Projet of `mirror.projects` whose repository the « Miroir » token covers. */
export type MirrorRepositoryProject = MirrorProject & { readonly repository: string; readonly githubRepoId: number; readonly installationId: number; readonly displayName: string };

/** Whether `project` has a repository whose access holds: what the token and the follower use. */
export const hasRepository = (project: MirrorProject): project is MirrorRepositoryProject =>
  project.repository !== null && project.githubRepoId !== null && project.installationId !== null && project.displayName !== null;

/**
 * Every Projet of the Pilote the Runner's Miroir copies (ADR 0010, ADR
 * 0012), in the order they were followed or created (then by id): where
 * each of its groups lives, its GitHub repository when its access is not
 * lost and an installation reaches it (else the four fields null), its
 * Local name sealed. A Projet whose groups are all on GitHub and whose
 * repository is unreachable is left out: nothing of it can be copied. A
 * group without its row (a Projet followed by the previous release during
 * a deploy, which `ProcessBackfill.completeSources` completes at the next
 * start) is on GitHub, as that backfill writes it. `scoped` is the
 * Pilote's client (ADR 0008).
 */
export const mirrorProjectsOf = (scoped: PrismaService['scoped']): Promise<MirrorProject[]> =>
  scoped.$transaction(async (tx) => {
    const projects = await tx.project.findMany({
      select: {
        id: true,
        repositoryId: true,
        githubRepoId: true,
        fullName: true,
        displayName: true,
        nameSealed: true,
        accessLost: true,
        integrationBranch: true,
        artifactSources: { select: { group: true, source: true } },
      },
      orderBy: [{ followedAt: 'asc' }, { id: 'asc' }],
    });
    const repositoryIds = projects.flatMap((project) => (project.repositoryId === null ? [] : [project.repositoryId]));
    const repositories = await tx.repository.findMany({ where: { id: { in: repositoryIds } }, select: { id: true, installationId: true } });
    const installations = new Map(repositories.map((repository) => [repository.id, Number(repository.installationId)]));
    return projects.flatMap((project): MirrorProject[] => {
      const sourceOf = (group: 'ticket' | 'code'): SourceKind => project.artifactSources.find((row) => row.group === group)?.source ?? 'github';
      const sources = { ticket: sourceOf('ticket'), code: sourceOf('code') };
      const installationId = project.repositoryId === null || project.accessLost ? undefined : installations.get(project.repositoryId);
      const reachable = installationId !== undefined && project.fullName !== null && project.displayName !== null && project.githubRepoId !== null;
      if (!reachable && sources.ticket === 'github' && sources.code === 'github') return [];
      return [
        {
          projectId: project.id,
          sources,
          repository: reachable ? project.fullName : null,
          githubRepoId: reachable ? Number(project.githubRepoId) : null,
          installationId: reachable ? installationId : null,
          displayName: reachable ? project.displayName : null,
          nameSealed: project.nameSealed === null ? null : zSealedItem.parse(project.nameSealed),
          integrationBranch: project.integrationBranch,
        },
      ];
    });
  });
