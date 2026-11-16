import { Module } from '@nestjs/common';
import { ProjectsModule } from '../../projects/projects.module.js';
import { RunnersModule } from '../../runners/runners.module.js';
import { GitHubChanges } from './github-changes.js';
import { MirrorRelay } from './mirror-relay.js';
import { MirrorTokens } from './mirror-token.js';
import { GitHubChangesRetention } from './retention.job.js';

/** GitHub's changes for the Runner's Miroir (MIROIR-1): their envelopes, their relay, their retention; the « Miroir » token (MIROIR-2). */
@Module({ imports: [RunnersModule, ProjectsModule], providers: [GitHubChanges, MirrorRelay, MirrorTokens, GitHubChangesRetention], exports: [MirrorRelay] })
export class GitHubChangesModule {}
