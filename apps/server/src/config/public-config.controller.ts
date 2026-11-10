import type { PublicConfig } from '@crewdeck/contracts';
import { zPublicConfig } from '@crewdeck/contracts';
import { Controller, Get, Inject, Module, Req } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { Public } from '../scope/public.decorator.js';
import { type Env, usesFakes } from './env.js';
import { ENV } from './env.module.js';

/** What the controller reads of Express's request. */
interface Request {
  readonly protocol: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export class PublicConfigDto extends createZodDto(zPublicConfig) {}

/** The first value of a header a proxy may have set more than once. */
const header = (request: Request, name: string): string | undefined => {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim() || undefined;
};

/**
 * `GET /api/config`: public, what the page needs before anyone signs in.
 * Where it reads GitHub with the Pilote's token (ADR 0002) and the App's
 * slug, to install it: GitHub's, or with the fakes `<origin>/fake-github`,
 * the origin being the page's (through Vite's proxy in development).
 */
@Public()
@Controller('config')
export class PublicConfigController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  @ZodResponse({ status: 200, description: 'Where the page reads GitHub.', type: PublicConfigDto })
  config(@Req() request: Request): PublicConfig {
    if (!usesFakes(this.env)) {
      return { githubApiUrl: this.env.GITHUB_API_URL, githubWebUrl: this.env.GITHUB_WEB_URL, appSlug: this.env.GITHUB_APP_SLUG ?? 'crewdeck' };
    }
    const fake = `${this.origin(request)}/fake-github`;
    return { githubApiUrl: fake, githubWebUrl: fake, appSlug: this.env.GITHUB_APP_SLUG ?? 'crewdeck' };
  }

  /** The origin the page was served from; the proxy's headers are trusted with the fakes only, never in production. */
  private origin(request: Request): string {
    if (this.env.PUBLIC_URL !== undefined) return new URL(this.env.PUBLIC_URL).origin;
    const protocol = header(request, 'x-forwarded-proto') ?? request.protocol;
    const host = header(request, 'x-forwarded-host') ?? header(request, 'host') ?? 'localhost';
    return `${protocol}://${host}`;
  }
}

@Module({ controllers: [PublicConfigController] })
export class PublicConfigModule {}
