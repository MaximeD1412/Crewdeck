/** Where a page of `GET /api/projects/:id/source-migrations` resumes: after the migration created at `createdAt` with `id`. */
export interface MigrationCursor {
  readonly createdAt: Date;
  readonly id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor the page sends back as is: opaque, base64url of `<createdAt ISO>|<id>`. */
export const encodeMigrationCursor = ({ createdAt, id }: MigrationCursor): string => Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

/** The cursor `encodeMigrationCursor` gave, or `undefined` for anything else. */
export const decodeMigrationCursor = (cursor: string): MigrationCursor | undefined => {
  const [at, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (at === undefined || id === undefined || rest.length > 0 || !UUID.test(id)) return undefined;
  const createdAt = new Date(at);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== at) return undefined;
  return { createdAt, id };
};
