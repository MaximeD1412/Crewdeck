import type { MirrorProject } from '@crewdeck/contracts';
import type { PrismaService } from '../../prisma/prisma.service.js';

/**
 * The Pilote's Projets that have a GitHub repository whose access is not
 * lost, with the installation that reaches each, in the order they were
 * followed: what `mirror.projects` lists and the « Miroir » token covers.
 * `scoped` is the Pilote's client (ADR 0008); a Projet whose repository has
 * no installation is skipped.
 */
export const mirrorProjectsOf = (scoped: PrismaService['scoped']): Promise<MirrorProject[]> =>
  scoped.$transaction(async (tx) => {
    const projects = await tx.project.findMany({
      where: { accessLost: false },
      select: { id: true, repositoryId: true, githubRepoId: true, fullName: true, displayName: true, integrationBranch: true },
      orderBy: { followedAt: 'asc' },
    });
    const repositories = await tx.repository.findMany({ where: { id: { in: projects.map((project) => project.repositoryId) } }, select: { id: true, installationId: true } });
    const installations = new Map(repositories.map((repository) => [repository.id, Number(repository.installationId)]));
    return projects.flatMap((project) => {
      const installationId = installations.get(project.repositoryId);
      if (installationId === undefined) return [];
      return [
        {
          projectId: project.id,
          repository: project.fullName,
          githubRepoId: Number(project.githubRepoId),
          installationId,
          displayName: project.displayName,
          integrationBranch: project.integrationBranch,
        },
      ];
    });
  });
