import type { INestApplication } from '@nestjs/common';
import { zPublicConfig } from '@crewdeck/contracts';
import { vapidEnv } from '../../test/github-app.js';
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
      runnerServer: started.url,
      vapidPublicKey: expect.stringMatching(/^[A-Za-z0-9_-]{87}$/),
    });
  });

  it('names the server of the Runner’s install command outside production only', async () => {
    const started = await boot({ PUBLIC_URL: 'https://staging.crewdeck.example' });
    app = started.app;

    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({ runnerServer: 'https://staging.crewdeck.example' });
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
      runnerServer: started.url,
      vapidPublicKey: expect.stringMatching(/^[A-Za-z0-9_-]{87}$/),
    });
  });

  it('gives the VAPID public key of VAPID_PUBLIC_KEY, the same at each call of a server that drew its own', async () => {
    const vapid = vapidEnv();
    const started = await boot(vapid);
    app = started.app;
    expect(await (await fetch(`${started.url}/api/config`)).json()).toMatchObject({ vapidPublicKey: vapid['VAPID_PUBLIC_KEY'] });
    await app.close();

    const drawing = await boot({});
    app = drawing.app;
    const first = ((await (await fetch(`${drawing.url}/api/config`)).json()) as { vapidPublicKey: string }).vapidPublicKey;
    expect(await (await fetch(`${drawing.url}/api/config`)).json()).toMatchObject({ vapidPublicKey: first });
  });

  it('gives the fake GitHub at the origin of the page behind the development proxy', async () => {
    const started = await boot({ CREWDECK_FAKES: '1' });
    app = started.app;

    const response = await fetch(`${started.url}/api/config`, { headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'localhost:4200' } });

    expect(await response.json()).toMatchObject({ githubApiUrl: 'http://localhost:4200/fake-github' });
  });
});
