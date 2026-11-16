/** Where a page of `GET /api/sessions` resumes: after the Session started at `startedAt` with `id`. */
export interface SessionCursor {
  readonly startedAt: Date;
  readonly id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor the page sends back as is: opaque, base64url of `<startedAt ISO>|<id>`. */
export const encodeSessionCursor = ({ startedAt, id }: SessionCursor): string => Buffer.from(`${startedAt.toISOString()}|${id}`).toString('base64url');

/** The cursor `encodeSessionCursor` gave, or `undefined` for anything else. */
export const decodeSessionCursor = (cursor: string): SessionCursor | undefined => {
  const [at, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (at === undefined || id === undefined || rest.length > 0 || !UUID.test(id)) return undefined;
  const startedAt = new Date(at);
  if (Number.isNaN(startedAt.getTime()) || startedAt.toISOString() !== at) return undefined;
  return { startedAt, id };
};
