import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zRunnerLatest } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { expectEnvelope, startApp } from '../../../test/route-baseline.js';
import { parseEnv } from '../../config/env.js';
import { INSTALL_SERVER, INSTALL_VERSION } from './runner-dist.controller.js';

const DATABASE_URL = 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck';

describe('the Runner’s distribution', () => {
  let dir: string;
  let app: INestApplication | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'runner-dist-'));
    await writeFile(join(dir, 'install.sh'), `#!/bin/sh\nserver='${INSTALL_SERVER}'\nversion='${INSTALL_VERSION}'\n`);
    await mkdir(join(dir, 'abc1234'));
    await writeFile(join(dir, 'abc1234', 'linux-amd64'), 'ELF');
    await writeFile(join(dir, 'abc1234', 'linux-amd64.sha256'), 'f00d  linux-amd64\n');
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  afterEach(() => app?.close());

  const boot = async (values: Record<string, string> = {}) => {
    const started = await startApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL, CREWDECK_COMMIT: 'abc1234', RUNNER_DIST_DIR: dir, ...values }));
    app = started.app;
    return started.url;
  };

  it('serves install.sh at /runner/install.sh, rendered with PUBLIC_URL and the version, without a session', async () => {
    const url = await boot({ PUBLIC_URL: 'https://staging.crewdeck.example' });

    const res = await fetch(`${url}/runner/install.sh`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/x-shellscript/);
    expect(await res.text()).toBe("#!/bin/sh\nserver='https://staging.crewdeck.example'\nversion='abc1234'\n");
  });

  it('renders install.sh with the origin of the page in development', async () => {
    const url = await boot();

    expect(await (await fetch(`${url}/runner/install.sh`, { headers: { 'x-forwarded-host': 'localhost:4200' } })).text()).toContain("server='http://localhost:4200'");
  });

  it('serves a binary and its checksum by version and platform', async () => {
    const url = await boot();

    const binary = await fetch(`${url}/runner/abc1234/linux-amd64`);
    expect(binary.status).toBe(200);
    expect(binary.headers.get('content-type')).toBe('application/octet-stream');
    expect(await binary.text()).toBe('ELF');
    expect(await (await fetch(`${url}/runner/abc1234/linux-amd64.sha256`)).text()).toBe('f00d  linux-amd64\n');
  });

  it('answers 404 runner-dist.not-found for an unknown version, platform or path, and without RUNNER_DIST_DIR', async () => {
    const url = await boot();

    for (const path of ['/runner/0000000/linux-amd64', '/runner/abc1234/darwin-arm64', '/runner/abc1234/windows-amd64', '/runner/..%2F..%2Fetc/passwd', '/runner/abc1234/..%2Finstall.sh']) {
      await expectEnvelope(await fetch(`${url}${path}`), 404, 'runner-dist.not-found');
    }
    await app?.close();
    app = (await startApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL }))).app;
    const bare = await app.getUrl();
    await expectEnvelope(await fetch(`${bare}/runner/install.sh`), 404, 'runner-dist.not-found');
  });

  it('says at /runner/latest the version of the binaries it serves, without a session nor RUNNER_DIST_DIR', async () => {
    const url = await boot();

    const res = await fetch(`${url}/runner/latest`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(zRunnerLatest.parse(await res.json())).toStrictEqual({ version: 'abc1234' });
    await app?.close();
    app = (await startApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL, CREWDECK_COMMIT: 'def5678' }))).app;
    expect(await (await fetch(`${await app.getUrl()}/runner/latest`)).json()).toStrictEqual({ version: 'def5678' });
  });

  it('leaves /api/runner/… under /api', async () => {
    const url = await boot();

    await expectEnvelope(await fetch(`${url}/api/runner/link/pas-un-id`), 404, 'runner.link-code-unknown');
  });
});
