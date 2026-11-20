import { type SourceMigrationGithubToken, zId, zSourceMigrationGithubToken } from '@crewdeck/contracts';
import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { RunnerTokenGuard } from '../../../devices/runner-token.guard.js';
import { notFound } from '../../../errors/app-error.js';
import { MESSAGES } from '../../../errors/messages.js';
import { Public } from '../../../scope/public.decorator.js';
import { SourceMigrationGithubTokens } from './source-migration-github-token.js';

export class SourceMigrationGithubTokenDto extends createZodDto(zSourceMigrationGithubToken) {}

/** `/api/runner/source-migrations`: what the Runner asks of its Pilote's migrations, with its token (no session cookie). */
@Public()
@UseGuards(RunnerTokenGuard)
@Controller('runner/source-migrations')
export class RunnerSourceMigrationsController {
  constructor(private readonly tokens: SourceMigrationGithubTokens) {}

  @Post(':id/github-token')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The migration’s GitHub token, its repository only, issues: write, 1 h (SOURCE-8).', type: SourceMigrationGithubTokenDto })
  githubToken(@Param('id') id: string): Promise<SourceMigrationGithubToken> {
    const parsed = zId.safeParse(id);
    if (!parsed.success) throw notFound('source-migration.not-found', MESSAGES['source-migration.not-found']);
    return this.tokens.issue(parsed.data);
  }
}
