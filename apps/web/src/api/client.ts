import type { z } from 'zod';
import { ApiError, call, type Method } from './request.js';

export interface ClientOptions {
  /** The store's `seq`, carried by every command. */
  readonly seq: () => bigint | null;
  /** On a 409 `realtime.stale`: the page asks the server what it missed (`hello`). */
  readonly onStale: () => void;
}

export interface Client {
  /** A read: a GET whose answer is read with `schema`. */
  query<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>>;
  /**
   * A command: `body` with the store's `seq` as a decimal string (ADR 0007),
   * `"0"` before any snapshot; its answer read with `schema` when given.
   * A refusal is an `ApiError`, whose `message` the page shows as is.
   */
  command<S extends z.ZodType>(method: Exclude<Method, 'GET'>, path: string, body: object, schema: S): Promise<z.output<S>>;
  command(method: Exclude<Method, 'GET'>, path: string, body: object): Promise<void>;
}

export const STALE_CODE = 'realtime.stale';

/** The page's way to the API (ADR 0008): reads, and commands carrying the `seq` the Pilote saw. */
export const createClient = ({ seq, onStale }: ClientOptions): Client => ({
  query: (path, schema) => call('GET', path, undefined, schema),
  async command(method: Exclude<Method, 'GET'>, path: string, body: object, schema?: z.ZodType): Promise<never> {
    try {
      return (await call(method, path, { ...body, seq: (seq() ?? 0n).toString() }, schema)) as never;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === STALE_CODE) onStale();
      throw error;
    }
  },
}) as Client;
