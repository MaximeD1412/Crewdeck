import { randomBytes } from 'node:crypto';
import { authKeysEnv, githubAppEnv, mailEnv, testPrivateKey } from '../../test/github-app.js';
import { appOrigin, loadEnv, parseEnv, usesFakes } from './env.js';

const DATABASE_URL = 'postgresql://crewdeck:crewdeck@localhost:5432/crewdeck';

describe('parseEnv', () => {
  it('applies the defaults', () => {
    expect(parseEnv({ CREWDECK_ENV: 'development', DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      CREWDECK_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      CREWDECK_COMMIT: 'dev',
      GITHUB_API_URL: 'https://api.github.com',
      GITHUB_WEB_URL: 'https://github.com',
    });
  });

  it('reads the given values', () => {
    const keys = authKeysEnv();
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
        ...githubAppEnv(),
        ...keys,
        ...mailEnv(),
        GITHUB_API_URL: 'https://ghe.example/api/v3',
        GITHUB_WEB_URL: 'https://ghe.example',
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
      ...githubAppEnv(),
      GITHUB_TOKEN_KEY: Buffer.from(keys.GITHUB_TOKEN_KEY, 'base64'),
      SESSION_SECRET: Buffer.from(keys.SESSION_SECRET, 'base64'),
      ...mailEnv(),
      GITHUB_API_URL: 'https://ghe.example/api/v3',
      GITHUB_WEB_URL: 'https://ghe.example',
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
      parseEnv({ CREWDECK_ENV, DATABASE_URL, PROD_PUBLIC_URL: 'https://crewdeck.example', PROD_GITHUB_APP_ID: '1', ...githubAppEnv(), ...authKeysEnv(), ...mailEnv() }),
    ).toThrow(expect.objectContaining({ keys: ['PUBLIC_URL'] }));
  });

  it.each(['development', 'test'])('does not require PUBLIC_URL in %s', (CREWDECK_ENV) => {
    expect(parseEnv({ CREWDECK_ENV, DATABASE_URL })).not.toHaveProperty('PUBLIC_URL');
  });

  it('requires the production values in staging', () => {
    expect(() =>
      parseEnv({ CREWDECK_ENV: 'staging', PUBLIC_URL: 'https://staging.crewdeck.example', DATABASE_URL, ...githubAppEnv(), ...authKeysEnv(), ...mailEnv() }),
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
        ...githubAppEnv(),
        ...authKeysEnv(), ...mailEnv(),
      }),
    ).toMatchObject({ PROD_PUBLIC_URL: 'https://crewdeck.example', PROD_GITHUB_APP_ID: '1' });
  });
});

describe('the GitHub App', () => {
  const production = { CREWDECK_ENV: 'production', PUBLIC_URL: 'https://crewdeck.example', DATABASE_URL, ...authKeysEnv(), ...mailEnv() };

  it.each(['production', 'staging'])('is required in %s', (CREWDECK_ENV) => {
    expect(() =>
      parseEnv({ ...production, CREWDECK_ENV, PROD_PUBLIC_URL: 'https://crewdeck.example', PROD_GITHUB_APP_ID: '1' }),
    ).toThrow(
      expect.objectContaining({
        keys: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_APP_SLUG', 'GITHUB_WEBHOOK_SECRET'],
      }),
    );
  });

  it.each(['development', 'test'])('is optional in %s', (CREWDECK_ENV) => {
    expect(parseEnv({ CREWDECK_ENV, DATABASE_URL })).not.toHaveProperty('GITHUB_APP_ID');
  });

  it('reads the private key as PEM, with its newlines escaped, or as base64 of the PEM', () => {
    const pem = testPrivateKey();
    const read = (GITHUB_APP_PRIVATE_KEY: string): unknown => parseEnv({ ...production, ...githubAppEnv(), GITHUB_APP_PRIVATE_KEY }).GITHUB_APP_PRIVATE_KEY;

    expect(read(pem)).toBe(pem);
    expect(read(pem.replaceAll('\n', '\\n'))).toBe(pem);
    expect(read(Buffer.from(pem).toString('base64'))).toBe(pem);
  });

  it('refuses a private key that is not a PEM', () => {
    expect(() => parseEnv({ ...production, ...githubAppEnv(), GITHUB_APP_PRIVATE_KEY: 'not-a-key' })).toThrow(
      expect.objectContaining({ keys: ['GITHUB_APP_PRIVATE_KEY'] }),
    );
  });
});

describe('CREWDECK_FAKES', () => {
  it('turns the fakes on with 1, outside production', () => {
    expect(usesFakes(parseEnv({ CREWDECK_ENV: 'development', DATABASE_URL, CREWDECK_FAKES: '1' }))).toBe(true);
    expect(usesFakes(parseEnv({ CREWDECK_ENV: 'development', DATABASE_URL }))).toBe(false);
  });

  it.each(['true', '0', 'yes'])('takes only 1, not %s', (CREWDECK_FAKES) => {
    expect(() => parseEnv({ CREWDECK_ENV: 'development', DATABASE_URL, CREWDECK_FAKES })).toThrow(
      expect.objectContaining({ keys: ['CREWDECK_FAKES'] }),
    );
  });

  it('is refused with NODE_ENV=production', () => {
    expect(() => parseEnv({ CREWDECK_ENV: 'test', NODE_ENV: 'production', DATABASE_URL, CREWDECK_FAKES: '1' })).toThrow(
      expect.objectContaining({ keys: ['CREWDECK_FAKES'] }),
    );
  });

  it.each(['production', 'staging'])('is refused on the %s server', (CREWDECK_ENV) => {
    const values = { CREWDECK_ENV, PUBLIC_URL: 'https://x.crewdeck.example', PROD_PUBLIC_URL: 'https://crewdeck.example', PROD_GITHUB_APP_ID: '1', DATABASE_URL };
    expect(() => parseEnv({ ...values, ...githubAppEnv(), ...authKeysEnv(), ...mailEnv(), NODE_ENV: 'development', CREWDECK_FAKES: '1' })).toThrow(
      expect.objectContaining({ keys: ['CREWDECK_FAKES'] }),
    );
  });

  it('stops the boot', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    loadEnv({ CREWDECK_ENV: 'test', NODE_ENV: 'production', DATABASE_URL, CREWDECK_FAKES: '1' });

    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.join('\n')).toMatch(/CREWDECK_FAKES/);
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

describe('the sign-in keys', () => {
  const production = { CREWDECK_ENV: 'production', PUBLIC_URL: 'https://crewdeck.example', DATABASE_URL, ...githubAppEnv(), ...mailEnv() };

  it.each(['production', 'staging'])('are required in %s', (CREWDECK_ENV) => {
    expect(() => parseEnv({ ...production, CREWDECK_ENV, PROD_PUBLIC_URL: 'https://crewdeck.example', PROD_GITHUB_APP_ID: '1' })).toThrow(
      expect.objectContaining({ keys: ['GITHUB_TOKEN_KEY', 'SESSION_SECRET'] }),
    );
  });

  it.each(['development', 'test'])('are optional in %s', (CREWDECK_ENV) => {
    expect(parseEnv({ CREWDECK_ENV, DATABASE_URL })).not.toHaveProperty('GITHUB_TOKEN_KEY');
  });

  it('reads them as their bytes, SESSION_SECRET as long as openssl rand -base64 48 makes it', () => {
    const tokenKey = randomBytes(32);
    const secret = randomBytes(48);

    const env = parseEnv({ ...production, GITHUB_TOKEN_KEY: tokenKey.toString('base64'), SESSION_SECRET: secret.toString('base64') });

    expect(env.GITHUB_TOKEN_KEY?.equals(tokenKey)).toBe(true);
    expect(env.SESSION_SECRET?.equals(secret)).toBe(true);
  });

  it.each([
    ['GITHUB_TOKEN_KEY', randomBytes(16).toString('base64')],
    ['GITHUB_TOKEN_KEY', randomBytes(48).toString('base64')],
    ['GITHUB_TOKEN_KEY', 'not base64!'],
    ['SESSION_SECRET', randomBytes(16).toString('base64')],
  ])('refuses %s=%s', (key, value) => {
    expect(() => parseEnv({ ...production, ...authKeysEnv(), ...mailEnv(), [key]: value })).toThrow(expect.objectContaining({ keys: [key] }));
  });
});

describe('the mail', () => {
  const production = { CREWDECK_ENV: 'production', PUBLIC_URL: 'https://crewdeck.example', DATABASE_URL, ...githubAppEnv(), ...authKeysEnv() };

  it.each(['production', 'staging'])('is required in %s', (CREWDECK_ENV) => {
    expect(() => parseEnv({ ...production, CREWDECK_ENV, PROD_PUBLIC_URL: 'https://crewdeck.example', PROD_GITHUB_APP_ID: '1' })).toThrow(
      expect.objectContaining({ keys: ['SMTP_URL', 'MAIL_FROM'] }),
    );
  });

  it.each(['development', 'test'])('is optional in %s', (CREWDECK_ENV) => {
    expect(parseEnv({ CREWDECK_ENV, DATABASE_URL })).not.toHaveProperty('SMTP_URL');
  });

  it.each(['smtp://relay.example:587', 'smtps://user:pass@relay.example:465'])('reads SMTP_URL=%s', (SMTP_URL) => {
    expect(parseEnv({ ...production, ...mailEnv(), SMTP_URL }).SMTP_URL).toBe(SMTP_URL);
  });

  it('requires MAIL_FROM with SMTP_URL', () => {
    expect(() => parseEnv({ CREWDECK_ENV: 'development', DATABASE_URL, SMTP_URL: 'smtp://localhost:1025' })).toThrow(
      expect.objectContaining({ keys: ['MAIL_FROM'] }),
    );
  });

  it.each(['https://relay.example', 'relay.example:587'])('refuses SMTP_URL=%s', (SMTP_URL) => {
    expect(() => parseEnv({ ...production, ...mailEnv(), SMTP_URL })).toThrow(expect.objectContaining({ keys: ['SMTP_URL'] }));
  });
});

describe('appOrigin', () => {
  it('is the origin of PUBLIC_URL, else the page of pnpm dev', () => {
    expect(appOrigin(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL, PUBLIC_URL: 'https://crewdeck.example/a-toi' }))).toBe('https://crewdeck.example');
    expect(appOrigin(parseEnv({ CREWDECK_ENV: 'development', DATABASE_URL }))).toBe('http://localhost:4200');
  });
});
