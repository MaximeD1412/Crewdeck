import { type Idea, type IdeaList, zIdea, zIdeaList, zListIdeasQuery, zNoteIdeaInput } from '@crewdeck/contracts';
import { Body, Controller, Get, Inject, Injectable, type OnModuleInit, Post, Query, UseGuards } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { NotRevokedDeviceGuard } from '../devices/trusted-device.guard.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { IdeasService, listIdeasHeld } from './ideas.service.js';

export class NoteIdeaDto extends createZodDto(zNoteIdeaInput) {}
export class ListIdeasQueryDto extends createZodDto(zListIdeasQuery) {}
export class IdeaDto extends createZodDto(zIdea) {}
export class IdeaListDto extends createZodDto(zIdeaList) {}

/** `POST /api/ideas`, `GET /api/ideas?states=`. */
@Controller('ideas')
export class IdeasController {
  constructor(private readonly ideas: IdeasService) {}

  @Post()
  @ZodResponse({ status: 201, description: 'The Idée noted, to triage, its text sealed as sent.', type: IdeaDto })
  note(@Body() body: NoteIdeaDto): Promise<Idea> {
    return this.ideas.note(currentPilotId(), body);
  }

  @Get()
  @UseGuards(NotRevokedDeviceGuard)
  @ZodResponse({ status: 200, description: 'A page of the Pilote’s Idées in these states, the last updated first.', type: IdeaListDto })
  list(@Query() query: ListIdeasQueryDto): Promise<IdeaList> {
    return this.ideas.list(query);
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
