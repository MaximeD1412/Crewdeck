import type { INestApplication } from '@nestjs/common';
import { expectEnvelope, startApp } from '../../test/route-baseline.js';
import { parseEnv } from '../config/env.js';
import { FAKES, type Fakes } from './fakes.js';

const DATABASE_URL = 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('/fake-github, what the page reads from GitHub', () => {
  describe('with CREWDECK_FAKES=1', () => {
    let app: INestApplication;
    let url: string;
    let sha: string;
    let fakes: Fakes;

    beforeAll(async () => {
      ({ app, url } = await startApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL, CREWDECK_FAKES: '1' })));
      fakes = app.get<Fakes>(FAKES);
      const repo = fakes.github.seedRepo({ owner: 'o', name: 'r', files: { 'docs/adr/0001-shape.md': '# Shape' } });
      sha = await fakes.github.pushCommit(repo, 'main', { 'docs/product/prd.md': '# PRD\n\nUS-60', 'captures/27/a-toi-390.png': PNG });
      await fakes.github.pushCommit(repo, 'feat/1-x', { 'src/a.ts': 'a' });
      const pr = await fakes.github.createPullRequest(repo, { head: 'feat/1-x', base: 'main', title: 'feat : x', draft: true });
      fakes.github.describePullRequest(repo, pr.number, { body: 'Closes #1', files: [{ filename: 'src/a.ts', status: 'added', patch: '+a' }] });
    });

    afterAll(() => app.close());

    it('serves a file at a SHA, its content in base64', async () => {
      const response = await fetch(`${url}/fake-github/repos/o/r/contents/docs/product/prd.md?ref=${sha}`);

      expect(response.status).toBe(200);
      const file = (await response.json()) as { type: string; path: string; encoding: string; content: string };
      expect(file).toMatchObject({ type: 'file', name: 'prd.md', path: 'docs/product/prd.md', encoding: 'base64' });
      expect(Buffer.from(file.content, 'base64').toString('utf8')).toBe('# PRD\n\nUS-60');
    });

    it('serves a directory as the list of its entries, on the default branch without a ref', async () => {
      const response = await fetch(`${url}/fake-github/repos/o/r/contents/docs`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([
        { type: 'dir', name: 'adr', path: 'docs/adr' },
        { type: 'dir', name: 'product', path: 'docs/product' },
      ]);
    });

    it('gives 404 for a file that does not exist at the ref', async () => {
      const response = await fetch(`${url}/fake-github/repos/o/r/contents/docs/product/prd.md?ref=feat/nope`);

      await expectEnvelope(response, 404, 'fake-github.not-found');
    });

    it('serves the raw bytes of a capture', async () => {
      const response = await fetch(`${url}/fake-github/raw/o/r/${sha}/captures/27/a-toi-390.png`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    });

    it('serves a PR with its body, and its files', async () => {
      const pr = await fetch(`${url}/fake-github/repos/o/r/pulls/1`);
      const files = await fetch(`${url}/fake-github/repos/o/r/pulls/1/files`);

      expect(await pr.json()).toMatchObject({ number: 1, title: 'feat : x', state: 'open', draft: true, body: 'Closes #1', head: { ref: 'feat/1-x' }, base: { ref: 'main' } });
      expect(await files.json()).toEqual([{ filename: 'src/a.ts', status: 'added', patch: '+a' }]);
    });

    it('authorizes at once: back to redirect_uri with fake-code and the state', async () => {
      const redirect = encodeURIComponent('http://localhost:4200/api/auth/callback?from=x');
      const response = await fetch(`${url}/fake-github/login/oauth/authorize?client_id=fake&redirect_uri=${redirect}&state=st4te`, { redirect: 'manual' });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('http://localhost:4200/api/auth/callback?from=x&code=fake-code&state=st4te');
    });

    it('leaves the API under /api', async () => {
      expect((await fetch(`${url}/api/health`)).status).toBe(200);
      expect((await fetch(`${url}/api/fake-github/repos/o/r/pulls/1`)).status).toBe(404);
    });
  });

  describe('without CREWDECK_FAKES', () => {
    let app: INestApplication;
    let url: string;

    beforeAll(async () => {
      ({ app, url } = await startApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL })));
    });

    afterAll(() => app.close());

    it.each(['/fake-github/repos/o/r/contents/docs/product/prd.md', '/fake-github/login/oauth/authorize?redirect_uri=http://x.example&state=s'])(
      'gives 404 for %s',
      async (path) => {
        await expectEnvelope(await fetch(`${url}${path}`, { redirect: 'manual' }), 404, 'http.not-found');
      },
    );

    it('has no fakes to inject', () => {
      expect(() => app.get(FAKES)).toThrow();
    });
  });
});
