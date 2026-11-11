import { randomBytes } from 'node:crypto';
import type { Env } from '../config/env.js';
import { TokenCipher } from './token-cipher.js';

/** The token of `SESSION_SECRET`'s bytes, which sign the `crewdeck_oauth` cookie. */
export const SESSION_SECRET = Symbol('SESSION_SECRET');

/**
 * The deployed servers have both keys (`parseEnv` requires them); a local
 * server without them draws its own at each boot: a restart then signs every
 * browser out, its GitHub tokens no longer open (`auth.github-expired`).
 */
export const sessionSecret = (env: Env): Buffer => env.SESSION_SECRET ?? randomBytes(32);

export const tokenCipher = (env: Env): TokenCipher => new TokenCipher(env.GITHUB_TOKEN_KEY ?? randomBytes(32));
