import { type GithubToken, zGithubToken } from '@crewdeck/contracts';
import { Controller, HttpCode, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { GithubTokens } from './github-tokens.js';

export class GithubTokenDto extends createZodDto(zGithubToken) {}

/** The Pilote's GitHub user token, for the page's reads of GitHub (ADR 0002). */
@Controller('github')
export class GithubTokenController {
  constructor(private readonly tokens: GithubTokens) {}

  /** `POST /api/github/token`: a POST, so that the Origin check guards it; 401 `auth.github-expired` when GitHub no longer grants it. */
  @Post('token')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The access token and when it expires.', type: GithubTokenDto })
  token(): Promise<GithubToken> {
    return this.tokens.current();
  }
}
