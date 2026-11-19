/** Where a page of `GET /api/ideas` resumes: after the Idée updated at `updatedAt` with `id`. */
export interface IdeaCursor {
  readonly updatedAt: Date;
  readonly id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor the page sends back as is: opaque, base64url of `<updatedAt ISO>|<id>`. */
export const encodeIdeaCursor = ({ updatedAt, id }: IdeaCursor): string => Buffer.from(`${updatedAt.toISOString()}|${id}`).toString('base64url');

/** The cursor `encodeIdeaCursor` gave, or `undefined` for anything else. */
export const decodeIdeaCursor = (cursor: string): IdeaCursor | undefined => {
  const [at, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (at === undefined || id === undefined || rest.length > 0 || !UUID.test(id)) return undefined;
  const updatedAt = new Date(at);
  if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== at) return undefined;
  return { updatedAt, id };
};
