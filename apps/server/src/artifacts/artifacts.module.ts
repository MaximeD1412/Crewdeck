import { Module } from '@nestjs/common';
import { CommandsModule } from '../commands/commands.module.js';
import { RunnersModule } from '../runners/runners.module.js';
import { ArtifactRelay } from './artifact-relay.js';

/**
 * Reading content in the page (SOURCE-4, ADR 0012): the relay of an
 * artefact a tab asks of the Runner, sealed by it for the Appareil that
 * asked, never kept (`ArtifactRelay`).
 */
@Module({
  imports: [RunnersModule, CommandsModule],
  providers: [ArtifactRelay],
})
export class ArtifactsModule {}
