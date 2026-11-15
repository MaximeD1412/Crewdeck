import type { GitHubChange } from '@crewdeck/contracts';

/** What of a `github_changes` row is read: all of it but its Pilote. */
export const CHANGE_VIEW = { seq: true, projectId: true, repository: true, kind: true, number: true, sha: true, ref: true, action: true, at: true } as const;

/** A `github_changes` row as Prisma reads it with `CHANGE_VIEW`. */
export interface ChangeRow {
  readonly seq: bigint;
  readonly projectId: string;
  readonly repository: string;
  readonly kind: GitHubChange['kind'];
  readonly number: number | null;
  readonly sha: string | null;
  readonly ref: string | null;
  readonly action: string | null;
  readonly at: Date;
}

/** The change of `github.changed`, from its row. */
export const toChange = (row: ChangeRow): GitHubChange => ({
  seq: Number(row.seq),
  projectId: row.projectId,
  repository: row.repository,
  kind: row.kind,
  number: row.number,
  sha: row.sha,
  ref: row.ref,
  action: row.action,
  at: row.at.toISOString(),
});
