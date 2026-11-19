import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GitHubEvents, type GitHubEvent } from '../webhooks/dispatcher.js';
import { CHANGE_VIEW, toChange } from './change.view.js';
import { CHANGE_EVENTS, changeOf } from './changes.mapping.js';
import { githubNamesOf } from '../../projects/project.view.js';
import { MirrorRelay } from './mirror-relay.js';

/**
 * GitHub's changes for the Runner's Miroir (ADR 0010, MIROIR-1): of each
 * webhook of a Projet whose access is not lost, one row of
 * `github_changes`, an envelope without content (ADR 0003) numbered by the
 * Pilote's `github_change_seq`, then relayed to the Runner once committed.
 * The counter's row lock orders two deliveries at once: the second waits for
 * the first's commit, so the seqs commit in their order, without a hole.
 */
@Injectable()
export class GitHubChanges implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly githubEvents: GitHubEvents,
    private readonly relay: MirrorRelay,
  ) {}

  onModuleInit(): void {
    for (const event of CHANGE_EVENTS) this.githubEvents.on(event, (delivery) => this.keep(delivery));
  }

  private async keep({ pilotId, event, payload, sourceAt }: GitHubEvent): Promise<void> {
    const facts = changeOf(event, payload);
    if (!facts) return;
    const { githubRepoId, ...envelope } = facts;
    const row = await this.prisma.scoped.$transaction(async (tx) => {
      const project = await tx.project.findFirst({ where: { githubRepoId: BigInt(githubRepoId), accessLost: false }, select: { id: true, owner: true, name: true, fullName: true } });
      if (!project) return null;
      const { githubChangeSeq: seq } = await tx.pilot.update({ where: { id: pilotId }, data: { githubChangeSeq: { increment: 1 } }, select: { githubChangeSeq: true } });
      return tx.gitHubChange.create({ data: { pilotId, seq, projectId: project.id, repository: githubNamesOf(project).fullName, ...envelope, at: sourceAt }, select: CHANGE_VIEW });
    });
    if (row) this.relay.publish(pilotId, toChange(row));
  }
}
