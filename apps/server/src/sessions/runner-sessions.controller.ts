import { type SessionGithubToken, zSessionGithubToken } from '@crewdeck/contracts';
import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RunnerTokenGuard } from '../devices/runner-token.guard.js';
import { Public } from '../scope/public.decorator.js';
import { SessionGithubTokens } from './session-github-token.js';
import { sessionId } from './sessions.controller.js';

export class SessionGithubTokenDto extends createZodDto(zSessionGithubToken) {}

/** `/api/runner/sessions`: what the Runner asks of its Pilote's Sessions, with its token (no session cookie). */
@Public()
@UseGuards(RunnerTokenGuard)
@Controller('runner/sessions')
export class RunnerSessionsController {
  constructor(private readonly tokens: SessionGithubTokens) {}

  @Post(':id/github-token')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Session’s GitHub token, its repository only, four permissions, 1 h (RUNNER-10).', type: SessionGithubTokenDto })
  githubToken(@Param('id') id: string): Promise<SessionGithubToken> {
    return this.tokens.issue(sessionId(id));
  }
}
