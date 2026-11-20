import { type Idea, type IdeaList, zIdea, zIdeaList, zListIdeasQuery, zNoteIdeaInput, zReanalyseIdeaInput, zSetIdeaTargetInput } from '@crewdeck/contracts';
import { Body, Controller, Get, HttpCode, Inject, Injectable, type OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { IdeaAnalysis } from './analysis.js';
import { IdeasService, listIdeasHeld } from './ideas.service.js';

export class NoteIdeaDto extends createZodDto(zNoteIdeaInput) {}
export class ListIdeasQueryDto extends createZodDto(zListIdeasQuery) {}
export class IdeaDto extends createZodDto(zIdea) {}
export class IdeaListDto extends createZodDto(zIdeaList) {}
export class SetIdeaTargetDto extends createZodDto(zSetIdeaTargetInput) {}
export class ReanalyseIdeaDto extends createZodDto(zReanalyseIdeaInput) {}

/** `POST /api/ideas`, `GET /api/ideas?states=`, `POST /api/ideas/:id/target`, `POST /api/ideas/:id/reanalyse`. */
@Controller('ideas')
export class IdeasController {
  constructor(
    private readonly ideas: IdeasService,
    private readonly analysis: IdeaAnalysis,
  ) {}

  @Post()
  @ZodResponse({ status: 201, description: 'The Idée noted, to triage, its text sealed as sent.', type: IdeaDto })
  note(@Body() body: NoteIdeaDto): Promise<Idea> {
    return this.ideas.note(currentPilotId(), body);
  }

  @Get()
  @ZodResponse({ status: 200, description: 'A page of the Pilote’s Idées in these states, the last updated first.', type: IdeaListDto })
  list(@Query() query: ListIdeasQueryDto): Promise<IdeaList> {
    return this.ideas.list(query);
  }

  @Post(':id/target')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Idée with its Projet visé changed (or « nouveau »), its analysis not run again.', type: IdeaDto })
  setTarget(@Param('id') id: string, @Body() body: SetIdeaTargetDto): Promise<Idea> {
    return this.analysis.setTarget(id, body);
  }

  @Post(':id/reanalyse')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Idée, its analysis run again (its previous one kept until the new one passes).', type: IdeaDto })
  reanalyse(@Param('id') id: string, @Body() body: ReanalyseIdeaDto): Promise<Idea> {
    return this.analysis.reanalyse(id, body);
  }
}

/** The `ideas` slice of `GET /api/state`: every Idée not merged nor rejected, those for 90 days, the last noted first. */
@Injectable()
export class IdeasState implements StateContributor<'ideas'>, OnModuleInit {
  readonly key = 'ideas';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx): Promise<Idea[]> {
    return listIdeasHeld(tx);
  }
}
