import { Module } from '@nestjs/common';
import { DecisionsModule } from '../decisions/decisions.module.js';
import { IdeasController, IdeasState } from './ideas.controller.js';
import { IdeasService } from './ideas.service.js';

/** The Idées (IDEE-1): `POST /api/ideas`, `GET /api/ideas`, the `ideas` slice, and the Décision `ideas-to-triage`. */
@Module({
  imports: [DecisionsModule],
  controllers: [IdeasController],
  providers: [IdeasService, IdeasState],
})
export class IdeasModule {}
