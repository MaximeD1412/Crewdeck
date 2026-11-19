import {
  type SourceMigration,
  type SourceMigrationPage,
  zId,
  zMigrateSourceInput,
  zRetrySourceMigrationInput,
  zSourceGroup,
  zSourceMigration,
  zSourceMigrationPage,
  zSourceMigrationQuery,
} from '@crewdeck/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type AppError, notFound } from '../../../errors/app-error.js';
import { MESSAGES } from '../../../errors/messages.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SensitiveAction } from '../../../sensitive-actions/sensitive-action.decorator.js';
import { SourceMigrations } from './source-migrations.service.js';

export class MigrateSourceInputDto extends createZodDto(zMigrateSourceInput) {}
export class RetrySourceMigrationInputDto extends createZodDto(zRetrySourceMigrationInput) {}
export class SourceMigrationQueryDto extends createZodDto(zSourceMigrationQuery) {}
export class SourceMigrationDto extends createZodDto(zSourceMigration) {}
export class SourceMigrationPageDto extends createZodDto(zSourceMigrationPage) {}

const projectNotFound = (): AppError => notFound('project.not-found', MESSAGES['project.not-found']);

/** The value of an id in the path; 404 `notFound()` for one that is not. */
const idOf = (value: string, notFoundError: () => AppError): string => {
  const parsed = zId.safeParse(value);
  if (!parsed.success) throw notFoundError();
  return parsed.data;
};

/**
 * `POST /api/projects/:id/sources/:group/migrate` (the Action sensible
 * `source.migrate`), `GET /api/projects/:id/source-migrations` and
 * `POST /api/source-migrations/:id/retry` (« Réessayer »): moving a Type
 * d'artefact to another Source (SOURCE-7, ADR 0012).
 */
@Controller()
export class SourceMigrationsController {
  constructor(
    private readonly migrations: SourceMigrations,
    private readonly prisma: PrismaService,
  ) {}

  @Post('projects/:id/sources/:group/migrate')
  @SensitiveAction('source.migrate')
  @ZodResponse({ status: 201, description: 'The migration, draining.', type: SourceMigrationDto })
  migrate(@Param('id') id: string, @Param('group') group: string, @Body() body: MigrateSourceInputDto): Promise<SourceMigration> {
    const project = idOf(id, projectNotFound);
    const parsed = zSourceGroup.safeParse(group);
    if (!parsed.success) throw projectNotFound();
    return this.migrations.migrate(project, parsed.data, body);
  }

  @Get('projects/:id/source-migrations')
  @ZodResponse({ status: 200, description: 'The Projet’s migrations of Source, the newest first.', type: SourceMigrationPageDto })
  list(@Param('id') id: string, @Query() query: SourceMigrationQueryDto): Promise<SourceMigrationPage> {
    return this.migrations.list(this.prisma.scoped, idOf(id, projectNotFound), query);
  }

  @Post('source-migrations/:id/retry')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The migration, draining again.', type: SourceMigrationDto })
  retry(@Param('id') id: string, @Body() body: RetrySourceMigrationInputDto): Promise<SourceMigration> {
    const migration = idOf(id, () => notFound('source-migration.not-found', MESSAGES['source-migration.not-found']));
    return this.migrations.retry(migration, BigInt(body.seq));
  }
}
