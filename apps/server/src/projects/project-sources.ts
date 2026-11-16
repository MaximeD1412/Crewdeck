import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** A group of a Projet's artifacts, each on one Source (ADR 0012): its Tickets, its changes of code. */
export type SourceGroup = 'ticket' | 'code';

/** Which Source holds each group of a Projet (ADR 0012), as `artifact_sources` says (SOURCE-1). */
@Injectable()
export class ProjectSources {
  constructor(private readonly prisma: PrismaService) {}

  /** Whether `group` of the Projet `projectId` (in the current Pilote's scope) is on GitHub; false for a Projet unknown. */
  async isGithub(projectId: string, group: SourceGroup): Promise<boolean> {
    return (await this.prisma.scoped.artifactSource.count({ where: { projectId, group, source: 'github' } })) > 0;
  }
}
