import { Module } from '@nestjs/common';
import { DecisionsController, DecisionsState } from './decisions.controller.js';
import { DecisionsService } from './decisions.service.js';

/** The Décisions (ATOI-1): `GET /api/decisions`, the `decisions` slice, and `DecisionsService`, which the modules import to raise and resolve theirs. */
@Module({
  controllers: [DecisionsController],
  providers: [DecisionsService, DecisionsState],
  exports: [DecisionsService],
})
export class DecisionsModule {}
