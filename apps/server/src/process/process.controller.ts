import { type ProjectProcess, zId, zProcessDraftInput, zProjectProcess } from '@crewdeck/contracts';
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type AppError, notFound } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProcessService, readProjectProcess } from './process.service.js';

export class ProcessDraftInputDto extends createZodDto(zProcessDraftInput) {}
export class ProjectProcessDto extends createZodDto(zProjectProcess) {}

const projectNotFound = (): AppError => notFound('project.not-found', MESSAGES['project.not-found']);

/** The Projet's id; 404 for one that is not an id. */
const projectId = (value: string): string => {
  const parsed = zId.safeParse(value);
  if (!parsed.success) throw projectNotFound();
  return parsed.data;
};

/**
 * `GET /api/projects/:id/process` and `PUT /api/projects/:id/process/draft`
 * (ADR 0011, one level deeper than ADR 0008's rule): a Projet's Process, and
 * its draft saved whole on every change of the canvas.
 */
@Controller('projects/:id/process')
export class ProcessController {
  constructor(
    private readonly process: ProcessService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The Projet’s Process: its active version and its draft.', type: ProjectProcessDto })
  async get(@Param('id') id: string): Promise<ProjectProcess> {
    const project = projectId(id);
    if ((await this.prisma.scoped.project.count({ where: { id: project } })) === 0) throw projectNotFound();
    return readProjectProcess(this.prisma.scoped, project);
  }

  @Put('draft')
  @ZodResponse({ status: 200, description: 'The Projet’s Process, its draft saved.', type: ProjectProcessDto })
  saveDraft(@Param('id') id: string, @Body() body: ProcessDraftInputDto): Promise<ProjectProcess> {
    return this.process.saveDraft(projectId(id), body);
  }
}
