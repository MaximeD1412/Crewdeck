import { Octokit } from '@octokit/core';
import { GitHubReadForbiddenError, installReadGuard } from './read-guard.js';

/** An Octokit whose requests end in a stub that records them, answering `{}`: nothing leaves the process. */
const guarded = (baseUrl = 'https://api.github.com') => {
  const sent: string[] = [];
  const fetch = (url: string | URL | Request): Promise<Response> => {
    sent.push(String(url));
    return Promise.resolve(Response.json({}));
  };
  const octokit = new Octokit({ baseUrl, request: { fetch } });
  installReadGuard(octokit);
  return { octokit, sent };
};

describe('the read guard', () => {
  it.each([
    'GET /repos/o/r/contents/src/main.ts',
    'GET /repos/o/r/contents/docs/adr/0001-shape.md',
    'GET /repos/o/r/contents/docs/adr/../../src/main.ts',
    'GET /repos/o/r/contents/.process.json',
    'GET /repos/o/r/contents/.process.json.bak',
    'GET /repos/o/r/contents',
    'GET /repos/o/r/pulls/3/files',
    'GET /repos/o/r/compare/main...feature',
    'GET /repos/o/r/git/blobs/abc',
    'GET /repos/o/r/git/trees/abc',
    'GET /repos/o/r/readme',
    'GET /repos/o/r/readme/docs',
    'GET /repos/o/r/tarball/main',
    'GET /repos/o/r/zipball/main',
    'POST /graphql',
  ])('throws for %s, and sends nothing', async (route) => {
    const { octokit, sent } = guarded();

    await expect(octokit.request(route)).rejects.toThrow(GitHubReadForbiddenError);
    expect(sent).toEqual([]);
  });

  it('throws for a path the route template encodes', async () => {
    const { octokit, sent } = guarded();

    await expect(octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner: 'o', repo: 'r', path: 'src/main.ts' })).rejects.toThrow(
      GitHubReadForbiddenError,
    );
    expect(sent).toEqual([]);
  });

  it.each(['application/vnd.github.diff', 'application/vnd.github.v3.patch', 'application/vnd.github.raw+json', 'application/vnd.github.v3.raw'])(
    'throws for a request whose accept is %s',
    async (accept) => {
      const { octokit, sent } = guarded();

      await expect(octokit.request('GET /repos/o/r/pulls/3', { headers: { accept } })).rejects.toThrow(GitHubReadForbiddenError);
      expect(sent).toEqual([]);
    },
  );

  it('throws for a diff asked through the media type', async () => {
    const { octokit } = guarded();

    await expect(octokit.request('GET /repos/o/r/pulls/3', { mediaType: { format: 'diff' } })).rejects.toThrow(GitHubReadForbiddenError);
  });

  it.each([
    'PUT /repos/o/r/contents/.process.json',
    'PUT /repos/o/r/contents/src/main.ts',
    'PUT /repos/o/r/contents/CONTEXT.md',
    'DELETE /repos/o/r/contents/.process.json',
    'DELETE /repos/o/r/contents/docs/adr',
  ])('throws for a write of a file, %s, and sends nothing', async (route) => {
    const { octokit, sent } = guarded();

    await expect(octokit.request(route, { message: 'x', content: '', sha: 'a'.repeat(40) })).rejects.toThrow(GitHubReadForbiddenError);
    expect(sent).toEqual([]);
  });

  it.each(['CONTEXT.md', 'docs/adr', 'docs/adr/'])('lets GET contents/%s through', async (path) => {
    const { octokit, sent } = guarded();

    await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner: 'o', repo: 'r', path, ref: 'main' });

    expect(sent).toHaveLength(1);
  });

  it.each(['GET /repos/o/r/labels', 'GET /repos/o/r/pulls/3', 'GET /repos/o/r/issues?state=open', 'PUT /repos/o/r/pulls/3/merge', 'POST /repos/o/r/merges'])(
    'lets the metadata through: %s',
    async (route) => {
      const { octokit, sent } = guarded();

      await octokit.request(route);

      expect(sent).toHaveLength(1);
    },
  );

  it('guards a GitHub Enterprise base URL the same', async () => {
    const { octokit } = guarded('https://ghe.example/api/v3');

    await expect(octokit.request('GET /repos/o/r/contents/src/main.ts')).rejects.toThrow(GitHubReadForbiddenError);
  });
});
