import type { RunnerLatest } from '@crewdeck/contracts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Controller, Get, Header, Inject, Param, Req, StreamableFile } from '@nestjs/common';
import { type Env, appOrigin } from '../../config/env.js';
import { ENV } from '../../config/env.module.js';
import { notFound } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { Public } from '../../scope/public.decorator.js';

/** A version as the image names it (`CREWDECK_COMMIT`): never a path. */
const VERSION = /^[0-9A-Za-z._-]{1,64}$/;
/** The platforms the Runner is built for (`runner:dist`), with or without `.sha256`. */
const FILE = /^(linux|darwin)-(amd64|arm64)(\.sha256)?$/;

/** The values `install.sh` is rendered with, placeholders the script keeps when served as is. */
export const INSTALL_SERVER = '__CREWDECK_SERVER__';
export const INSTALL_VERSION = '__CREWDECK_VERSION__';

/** What the controller reads of Express's request, outside production. */
interface Request {
  readonly protocol: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * The controller's path: `/runner/…` is rewritten to it before Nest routes
 * the request (`toRunnerDist`), outside the `/api` prefix, while the link's
 * routes stay at `/api/runner/…`.
 */
export const RUNNER_DIST_ROUTE = 'runner-dist';

/** `/runner/install.sh` → `/runner-dist/install.sh`: the URLs of ADR 0004, mounted first in `mountApi`. */
export const toRunnerDist = (request: { url: string }, _response: unknown, next: () => void): void => {
  if (request.url.startsWith('/runner/')) request.url = `/${RUNNER_DIST_ROUTE}${request.url.slice('/runner'.length)}`;
  next();
};

const missing = () => notFound('runner-dist.not-found', MESSAGES['runner-dist.not-found']);

/**
 * The Runner's distribution, public (ADR 0004): `GET /runner/install.sh`,
 * rendered with this server's URL and version, and `GET
 * /runner/<version>/<os>-<arch>` with its `.sha256`, from `RUNNER_DIST_DIR`
 * (`<dir>/install.sh`, `<dir>/<version>/<os>-<arch>`, as `runner:dist` and
 * the image lay them out). 404 for a version or a system it does not have.
 * `GET /runner/latest` says the version it serves, for the Runner's
 * `status` and its self-update.
 */
@Public()
@Controller(RUNNER_DIST_ROUTE)
export class RunnerDistController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('install.sh')
  @Header('Content-Type', 'text/x-shellscript; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async install(@Req() request: Request): Promise<string> {
    const script = await this.read('install.sh');
    return script.toString('utf8').replaceAll(INSTALL_SERVER, this.server(request)).replaceAll(INSTALL_VERSION, this.env.CREWDECK_COMMIT);
  }

  @Get('latest')
  @Header('Cache-Control', 'no-store')
  latest(): RunnerLatest {
    return { version: this.env.CREWDECK_COMMIT };
  }

  @Get(':version/:file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async binary(@Param('version') version: string, @Param('file') file: string): Promise<StreamableFile> {
    if (!VERSION.test(version) || !FILE.test(file)) throw missing();
    const bytes = await this.read(join(version, file));
    return new StreamableFile(bytes, { type: file.endsWith('.sha256') ? 'text/plain; charset=utf-8' : 'application/octet-stream' });
  }

  /** `PUBLIC_URL`'s origin where it is set; in development, the origin the page was served from (Vite's proxy). */
  private server(request: Request): string {
    if (this.env.PUBLIC_URL !== undefined) return appOrigin(this.env);
    const first = (name: string) => {
      const value = request.headers[name];
      return (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim() || undefined;
    };
    return `${first('x-forwarded-proto') ?? request.protocol}://${first('x-forwarded-host') ?? first('host') ?? 'localhost'}`;
  }

  private async read(path: string): Promise<Buffer> {
    if (this.env.RUNNER_DIST_DIR === undefined) throw missing();
    try {
      return await readFile(join(this.env.RUNNER_DIST_DIR, path));
    } catch {
      throw missing();
    }
  }
}
