import { Controller, Get, Inject, Param, Query, Redirect, StreamableFile } from '@nestjs/common';
import { AppError, notFound } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { Public } from '../scope/public.decorator.js';
import type { FileContent } from './fake-github.js';
import { FAKES, type Fakes } from './fakes.js';

/** Express 5 gives a wildcard's segments as an array. */
type Wildcard = string | string[];
const joined = (path: Wildcard): string => (Array.isArray(path) ? path.join('/') : path);

const missing = (): AppError => notFound('fake-github.not-found', MESSAGES['fake-github.not-found']);

/** The media types of what a repository holds and the page shows: the captures, a video, text. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  json: 'application/json',
};
const mediaType = (path: string): string => MEDIA_TYPES[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'text/plain; charset=utf-8';

const bytes = (content: FileContent): Buffer => (typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content));

/**
 * What the page reads from GitHub with the Pilote's token (ADR 0002), served
 * from the fake GitHub in GitHub's own shapes, at `/fake-github` (outside
 * `/api`): `GET /api/config` gives this URL as `githubApiUrl` with the fakes.
 * The token is not checked.
 */
@Public()
@Controller('fake-github')
export class FakeGitHubController {
  constructor(@Inject(FAKES) private readonly fakes: Fakes) {}

  /** A file (its content in base64) or a directory (its entries), at `ref` or on the default branch. */
  @Get('repos/:owner/:repo/contents/*path')
  contents(@Param('owner') owner: string, @Param('repo') repo: string, @Param('path') wildcard: Wildcard, @Query('ref') ref?: string): unknown {
    const path = joined(wildcard).replace(/\/$/, '');
    const file = this.fakes.github.fileAt(owner, repo, ref, path);
    if (file !== undefined) {
      const content = bytes(file);
      return { type: 'file', name: path.split('/').at(-1), path, size: content.length, encoding: 'base64', content: content.toString('base64') };
    }
    const entries = this.fakes.github.directoryAt(owner, repo, ref, path);
    if (entries === undefined) throw missing();
    return entries.map((entry) => ({ type: entry.type, name: entry.name, path: entry.path }));
  }

  @Get('repos/:owner/:repo/pulls/:number')
  pullRequest(@Param('owner') owner: string, @Param('repo') repo: string, @Param('number') number: string): unknown {
    const pr = this.fakes.github.pullRequestPage(owner, repo, Number(number));
    if (pr === undefined) throw missing();
    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      draft: pr.draft,
      merged: pr.merged,
      body: pr.body,
      head: { ref: pr.headRef, sha: pr.headSha },
      base: { ref: pr.baseRef },
      labels: pr.labels.map((name) => ({ name })),
      updated_at: pr.updatedAt,
    };
  }

  @Get('repos/:owner/:repo/pulls/:number/files')
  pullRequestFiles(@Param('owner') owner: string, @Param('repo') repo: string, @Param('number') number: string): unknown {
    const pr = this.fakes.github.pullRequestPage(owner, repo, Number(number));
    if (pr === undefined) throw missing();
    return pr.files;
  }

  /** A file's bytes, as `raw.githubusercontent.com` serves them (the captures of a visual review). */
  @Get('raw/:owner/:repo/:ref/*path')
  raw(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('ref') ref: string,
    @Param('path') wildcard: Wildcard,
  ): StreamableFile {
    const path = joined(wildcard);
    const file = this.fakes.github.fileAt(owner, repo, ref, path);
    if (file === undefined) throw missing();
    return new StreamableFile(bytes(file), { type: mediaType(path) });
  }

  /** The authorize page, which authorizes at once: back to `redirect_uri` with `fake-code` and the state. */
  @Get('login/oauth/authorize')
  @Redirect()
  authorize(@Query('redirect_uri') redirectUri: string | undefined, @Query('state') state: string | undefined): { url: string; statusCode: number } {
    if (redirectUri === undefined || !URL.canParse(redirectUri)) throw missing();
    const url = new URL(redirectUri);
    url.searchParams.set('code', 'fake-code');
    url.searchParams.set('state', state ?? '');
    return { url: url.toString(), statusCode: 302 };
  }
}
