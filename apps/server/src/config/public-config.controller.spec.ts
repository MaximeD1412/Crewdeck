import type { INestApplication } from '@nestjs/common';
import { zPublicConfig } from '@crewdeck/contracts';
import { startApp } from '../../test/route-baseline.js';
import { parseEnv } from './env.js';

const DATABASE_URL = 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck';

const boot = async (values: Record<string, string>): Promise<{ app: INestApplication; url: string }> =>
  startApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL, ...values }));

describe('GET /api/config', () => {
  let app: INestApplication | undefined;

  afterEach(() => app?.close());

  it('gives GitHub.com, without a session', async () => {
    const started = await boot({ GITHUB_APP_SLUG: 'crewdeck-staging' });
    app = started.app;

    const response = await fetch(`${started.url}/api/config`);

    expect(response.status).toBe(200);
    expect(zPublicConfig.parse(await response.json())).toEqual({
      githubApiUrl: 'https://api.github.com',
      githubWebUrl: 'https://github.com',
      appSlug: 'crewdeck-staging',
    });
  });

  it('gives the GitHub of GITHUB_API_URL and GITHUB_WEB_URL', async () => {
    const started = await boot({ GITHUB_API_URL: 'https://ghe.example/api/v3', GITHUB_WEB_URL: 'https://ghe.example' });
    app = started.app;

    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({ githubApiUrl: 'https://ghe.example/api/v3', githubWebUrl: 'https://ghe.example' });
  });

  it('gives the fake GitHub of the server with CREWDECK_FAKES=1', async () => {
    const started = await boot({ CREWDECK_FAKES: '1' });
    app = started.app;

    expect(await (await fetch(`${started.url}/api/config`)).json()).toEqual({
      githubApiUrl: `${started.url}/fake-github`,
      githubWebUrl: `${started.url}/fake-github`,
      appSlug: 'crewdeck',
    });
  });

  it('gives the fake GitHub at the origin of the page behind the development proxy', async () => {
    const started = await boot({ CREWDECK_FAKES: '1' });
    app = started.app;

    const response = await fetch(`${started.url}/api/config`, { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'localhost:4200' } });

    expect(await response.json()).toMatchObject({ githubApiUrl: 'http://localhost:4200/fake-github' });
  });
});
