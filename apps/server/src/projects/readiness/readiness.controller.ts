import { type Project, zFixReadiness, zId, zProject, zReadinessFixId } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { notFound, unprocessable } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { ReadinessService } from './readiness.service.js';

export class FixReadinessDto extends createZodDto(zFixReadiness) {}
export class ReadinessProjectDto extends createZodDto(zProject) {}

/**
 * `POST /api/projects/:id/fixes/:checkId` (session, PROJET-3): the fix of one
 * check of the Projet's readiness, where it is made (the labels and the
 * integration branch on GitHub, the folder on the Runner); the Projet, its
 * readiness computed again. 404 for an id that is not one, 422
 * `project.fix-unavailable` for a check that has no fix here.
 */
@Controller('projects/:id/fixes')
export class ReadinessController {
  constructor(private readonly readiness: ReadinessService) {}

  @Post(':checkId')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Projet, its readiness computed again after the fix.', type: ReadinessProjectDto })
  fix(@Param('id') id: string, @Param('checkId') checkId: string, @Body() body: FixReadinessDto): Promise<Project> {
    const project = zId.safeParse(id);
    if (!project.success) throw notFound('project.not-found', MESSAGES['project.not-found']);
    const check = zReadinessFixId.safeParse(checkId);
    if (!check.success) throw unprocessable('project.fix-unavailable', MESSAGES['project.fix-unavailable']);
    // createZodDto types the codec's output loosely: zSeq gives a bigint.
    return this.readiness.fix(currentPilotId(), project.data, check.data, BigInt(body.seq as bigint | number));
  }
}
