import type { Env } from './env.js';

/** Production's database as Compose names it in `crewdeck-prod`: the service alias or its container. */
const PRODUCTION_DATABASE_HOST = /^crewdeck-prod-db(-\d+)?$/;

const sameUrl = (a: string, b: string): boolean => new URL(a).href.replace(/\/$/, '') === new URL(b).href.replace(/\/$/, '');

/**
 * The first key of a staging server set to production's value, or undefined.
 * Staging runs beside production on the same VPS with the same image (ADR
 * 0009): a copied env file must not let it serve production's domain, act as
 * production's GitHub App, or write in production's database.
 */
export const findProductionKey = (env: Env): 'PUBLIC_URL' | 'GITHUB_APP_ID' | 'DATABASE_URL' | undefined => {
  if (env.CREWDECK_ENV !== 'staging') return undefined;
  if (env.PUBLIC_URL && env.PROD_PUBLIC_URL && sameUrl(env.PUBLIC_URL, env.PROD_PUBLIC_URL)) return 'PUBLIC_URL';
  if (env.GITHUB_APP_ID !== undefined && env.GITHUB_APP_ID === env.PROD_GITHUB_APP_ID) return 'GITHUB_APP_ID';
  if (PRODUCTION_DATABASE_HOST.test(new URL(env.DATABASE_URL).hostname)) return 'DATABASE_URL';
  return undefined;
};

/** Run at boot (`main.ts`): a staging set with production's configuration exits non-zero. */
export const enforceStagingGuard = (env: Env): void => {
  const key = findProductionKey(env);
  if (key === undefined) return;
  console.error(`Staging refuse de démarrer avec la configuration de la production : ${key}`);
  process.exit(1);
};
