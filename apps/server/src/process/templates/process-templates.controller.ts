import { type ProcessTemplate, zProcessTemplate, zRenameProcessTemplateInput, zSaveProcessTemplateInput } from '@crewdeck/contracts';
import { Body, Controller, Delete, HttpCode, Inject, Injectable, type OnModuleInit, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import type { AuthResponse } from '../../auth/auth.request.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../../realtime/state-contributors.js';
import type { Tx } from '../../realtime/transactions.js';
import { ProcessTemplatesService } from './process-templates.service.js';

export class SaveProcessTemplateInputDto extends createZodDto(zSaveProcessTemplateInput) {}
export class RenameProcessTemplateInputDto extends createZodDto(zRenameProcessTemplateInput) {}
export class ProcessTemplateDto extends createZodDto(zProcessTemplate) {}

/**
 * `POST /api/process-templates`, `PATCH` and `DELETE /api/process-templates/:id`
 * (PROCESS-14, ADR 0011): the Pilote's Modèles de process, listed by the
 * `processTemplates` slice of `GET /api/state`.
 */
@Controller('process-templates')
export class ProcessTemplatesController {
  constructor(private readonly templates: ProcessTemplatesService) {}

  @Post()
  @HttpCode(201)
  @ZodResponse({ status: 201, description: 'The Modèle saved from the Projet’s active version.', type: ProcessTemplateDto })
  @ApiResponse({ status: 200, description: 'The Modèle of the same name replaced (`replace: true`).', type: ProcessTemplateDto })
  async save(@Body() body: SaveProcessTemplateInputDto, @Res({ passthrough: true }) response: AuthResponse): Promise<ProcessTemplate> {
    const { template, created } = await this.templates.save(body);
    if (!created) response.statusCode = 200;
    return template;
  }

  @Patch(':id')
  @ZodResponse({ status: 200, description: 'The Modèle renamed.', type: ProcessTemplateDto })
  rename(@Param('id') id: string, @Body() body: RenameProcessTemplateInputDto): Promise<ProcessTemplate> {
    return this.templates.rename(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.templates.remove(id);
  }
}

/** The `processTemplates` slice of `GET /api/state`: the Pilote's Modèles, newest first. */
@Injectable()
export class ProcessTemplatesState implements StateContributor<'processTemplates'>, OnModuleInit {
  readonly key = 'processTemplates';

  constructor(
    @Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors,
    private readonly templates: ProcessTemplatesService,
  ) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx): Promise<ProcessTemplate[]> {
    return this.templates.list(tx);
  }
}
