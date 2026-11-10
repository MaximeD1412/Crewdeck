import { loadEnv, parseEnv } from './env.js';

const DATABASE_URL = 'postgresql://crewdeck:crewdeck@localhost:5432/crewdeck';

describe('parseEnv', () => {
  it('applies the defaults', () => {
    expect(parseEnv({ CREWDECK_ENV: 'development', DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      CREWDECK_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      CREWDECK_COMMIT: 'dev',
    });
  });

  it('reads the given values', () => {
    expect(
      parseEnv({
        NODE_ENV: 'production',
        CREWDECK_ENV: 'production',
        PUBLIC_URL: 'https://crewdeck.example',
        PORT: '8080',
        DATABASE_URL,
        CREWDECK_COMMIT: 'abc123',
        WEB_DIST_DIR: '/app/web',
        RUNNER_DIST_DIR: '/app/runner',
        GITHUB_APP_ID: '42',
      }),
    ).toEqual({
      NODE_ENV: 'production',
      CREWDECK_ENV: 'production',
      PUBLIC_URL: 'https://crewdeck.example',
      PORT: 8080,
      DATABASE_URL,
      CREWDECK_COMMIT: 'abc123',
      WEB_DIST_DIR: '/app/web',
      RUNNER_DIST_DIR: '/app/runner',
      GITHUB_APP_ID: '42',
    });
  });

  it('lists every failed key', () => {
    expect(() => parseEnv({ CREWDECK_ENV: 'recette', PORT: 'http' })).toThrow(
      expect.objectContaining({ keys: ['CREWDECK_ENV', 'PORT', 'DATABASE_URL'] }),
    );
  });

  it('requires CREWDECK_ENV', () => {
    expect(() => parseEnv({ DATABASE_URL })).toThrow(expect.objectContaining({ keys: ['CREWDECK_ENV'] }));
  });

  it.each(['production', 'staging'])('requires PUBLIC_URL in %s', (CREWDECK_ENV) => {
    expect(() =>
      parseEnv({ CREWDECK_ENV, DATABASE_URL, PROD_PUBLIC_URL: 'https://crewdeck.example', PROD_GITHUB_APP_ID: '1' }),
    ).toThrow(expect.objectContaining({ keys: ['PUBLIC_URL'] }));
  });

  it.each(['development', 'test'])('does not require PUBLIC_URL in %s', (CREWDECK_ENV) => {
    expect(parseEnv({ CREWDECK_ENV, DATABASE_URL })).not.toHaveProperty('PUBLIC_URL');
  });

  it('requires the production values in staging', () => {
    expect(() =>
      parseEnv({ CREWDECK_ENV: 'staging', PUBLIC_URL: 'https://staging.crewdeck.example', DATABASE_URL }),
    ).toThrow(expect.objectContaining({ keys: ['PROD_PUBLIC_URL', 'PROD_GITHUB_APP_ID'] }));
  });

  it('reads the production values in staging', () => {
    expect(
      parseEnv({
        CREWDECK_ENV: 'staging',
        PUBLIC_URL: 'https://staging.crewdeck.example',
        PROD_PUBLIC_URL: 'https://crewdeck.example',
        PROD_GITHUB_APP_ID: '1',
        DATABASE_URL,
      }),
    ).toMatchObject({ PROD_PUBLIC_URL: 'https://crewdeck.example', PROD_GITHUB_APP_ID: '1' });
  });
});

describe('loadEnv', () => {
  it('exits the process with the failed keys listed', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    loadEnv({ CREWDECK_ENV: 'development', PORT: '-1' });

    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.join('\n')).toMatch(/PORT[\s\S]*DATABASE_URL/);
  });
});
