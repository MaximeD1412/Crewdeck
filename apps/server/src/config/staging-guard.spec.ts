import { authKeysEnv, githubAppEnv, mailEnv } from '../../test/github-app.js';
import { parseEnv } from './env.js';
import { enforceStagingGuard, findProductionKey } from './staging-guard.js';

const staging = {
  CREWDECK_ENV: 'staging',
  PUBLIC_URL: 'https://staging.crewdeck.example',
  PROD_PUBLIC_URL: 'https://crewdeck.example',
  PROD_GITHUB_APP_ID: '1001',
  ...githubAppEnv(),
  ...authKeysEnv(), ...mailEnv(),
  GITHUB_APP_ID: '2002',
  DATABASE_URL: 'postgresql://crewdeck:secret@db:5432/crewdeck',
};

describe('findProductionKey', () => {
  it('accepts a staging configured as staging', () => {
    expect(findProductionKey(parseEnv(staging))).toBeUndefined();
  });

  it.each([
    ['PUBLIC_URL', { PUBLIC_URL: 'https://crewdeck.example' }],
    ['PUBLIC_URL', { PUBLIC_URL: 'https://CREWDECK.example/' }],
    ['GITHUB_APP_ID', { GITHUB_APP_ID: '1001' }],
    ['DATABASE_URL', { DATABASE_URL: 'postgresql://crewdeck:secret@crewdeck-prod-db:5432/crewdeck' }],
    ['DATABASE_URL', { DATABASE_URL: 'postgresql://crewdeck:secret@crewdeck-prod-db-1:5432/crewdeck' }],
  ])('finds %s set to the production value (%o)', (key, values) => {
    expect(findProductionKey(parseEnv({ ...staging, ...values }))).toBe(key);
  });

  it('checks nothing outside staging', () => {
    expect(
      findProductionKey(
        parseEnv({
          CREWDECK_ENV: 'production',
          PUBLIC_URL: 'https://crewdeck.example',
          DATABASE_URL: 'postgresql://crewdeck:secret@crewdeck-prod-db:5432/crewdeck',
          ...githubAppEnv(),
          ...authKeysEnv(), ...mailEnv(),
        }),
      ),
    ).toBeUndefined();
  });
});

describe('enforceStagingGuard', () => {
  it.each([
    ['PUBLIC_URL', { PUBLIC_URL: 'https://crewdeck.example' }],
    ['GITHUB_APP_ID', { GITHUB_APP_ID: '1001' }],
    ['DATABASE_URL', { DATABASE_URL: 'postgresql://crewdeck:secret@crewdeck-prod-db:5432/crewdeck' }],
  ])('exits non-zero with the French message for %s', (key, values) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    enforceStagingGuard(parseEnv({ ...staging, ...values }));

    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(`Staging refuse de démarrer avec la configuration de la production : ${key}`);
  });

  it('lets a staging configured as staging go on', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    enforceStagingGuard(parseEnv(staging));

    expect(exit).not.toHaveBeenCalled();
  });
});
