/** Where a page of `GET /api/decisions?state=resolved` resumes: after the Décision created at `createdAt` with `id`. */
export interface DecisionCursor {
  readonly createdAt: Date;
  readonly id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor the page sends back as is: opaque, base64url of `<createdAt ISO>|<id>`. */
export const encodeDecisionCursor = ({ createdAt, id }: DecisionCursor): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

/** The cursor `encodeDecisionCursor` gave, or `undefined` for anything else. */
export const decodeDecisionCursor = (cursor: string): DecisionCursor | undefined => {
  const [at, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (at === undefined || id === undefined || rest.length > 0 || !UUID.test(id)) return undefined;
  const createdAt = new Date(at);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== at) return undefined;
  return { createdAt, id };
};
