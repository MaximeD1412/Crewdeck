import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { InstallationFacts } from './payload.js';

/** An installation linked to its Pilote and not suspended: what the reconciliation reads. */
export interface LinkedInstallation {
  readonly installationId: number;
  readonly pilotId: string;
}

/**
 * The App's installations index (`github_installations`, global, ADR 0008):
 * which Pilote an installation's webhooks belong to. Maintained from the
 * `installation` events by the dispatcher; an installation by a GitHub user
 * who is not a Pilote yet is kept unlinked, and linked at their sign-in.
 */
@Injectable()
export class GitHubInstallations {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `installation.created`: kept, linked to the Pilote whose GitHub user
   * installed it, if there is one. Unlinked, the Pilote is read again once the
   * row is written: a sign-in between the first read and the write found no
   * row to link (`linkPendingTo`), and is caught here; one after the write
   * links it itself.
   */
  async created(facts: InstallationFacts): Promise<void> {
    const pilot = await this.pilotOfGitHubUser(facts.senderId);
    const row = {
      accountLogin: facts.accountLogin,
      accountId: BigInt(facts.accountId),
      senderId: BigInt(facts.senderId),
      pilotId: pilot,
      suspended: facts.suspended,
    };
    await this.prisma.unscoped.gitHubInstallation.upsert({
      where: { installationId: BigInt(facts.installationId) },
      create: { installationId: BigInt(facts.installationId), ...row },
      update: row,
    });
    if (pilot) return;
    const late = await this.pilotOfGitHubUser(facts.senderId);
    if (late) await this.linkPendingTo(late, facts.senderId);
  }

  /** The Pilote whose `github` Identité is the GitHub user `githubUserId` (ADR 0014), or `null`. */
  private async pilotOfGitHubUser(githubUserId: number): Promise<string | null> {
    const identity = await this.prisma.unscoped.pilotIdentity.findUnique({
      where: { provider_subject: { provider: 'github', subject: String(githubUserId) } },
      select: { pilotId: true },
    });
    return identity?.pilotId ?? null;
  }

  /** `installation.deleted`: the installation leaves the index. */
  async deleted(installationId: number): Promise<void> {
    await this.prisma.unscoped.gitHubInstallation.deleteMany({ where: { installationId: BigInt(installationId) } });
  }

  /** `installation.suspend` and `unsuspend`. */
  async setSuspended(installationId: number, suspended: boolean): Promise<void> {
    await this.prisma.unscoped.gitHubInstallation.updateMany({ where: { installationId: BigInt(installationId) }, data: { suspended } });
  }

  /** The Pilote of an installation; `null` when it is unknown or not linked yet. */
  async pilotOf(installationId: number): Promise<string | null> {
    const row = await this.prisma.unscoped.gitHubInstallation.findUnique({ where: { installationId: BigInt(installationId) }, select: { pilotId: true } });
    return row?.pilotId ?? null;
  }

  /** At a sign-in: the installations the GitHub user `githubUserId` made before being a Pilote become theirs. */
  async linkPendingTo(pilotId: string, githubUserId: number): Promise<number> {
    const { count } = await this.prisma.unscoped.gitHubInstallation.updateMany({
      where: { pilotId: null, senderId: BigInt(githubUserId) },
      data: { pilotId },
    });
    return count;
  }

  /** The installations linked to a Pilote and not suspended, oldest first. */
  async linked(): Promise<LinkedInstallation[]> {
    const rows = await this.prisma.unscoped.gitHubInstallation.findMany({
      where: { pilotId: { not: null }, suspended: false },
      select: { installationId: true, pilotId: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.flatMap((row) => (row.pilotId ? [{ installationId: Number(row.installationId), pilotId: row.pilotId }] : []));
  }
}
