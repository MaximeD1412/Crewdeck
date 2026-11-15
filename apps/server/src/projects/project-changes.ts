import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/** Called with the Pilote whose Projets changed, once the change is committed. */
export type ProjectsChangedHandler = (pilotId: string) => void;

/**
 * Who learns that a Pilote's Projets changed (a Projet followed, its access
 * lost or back), after the commit: the Runner's Miroir is sent its Projets
 * again (`mirror.projects`, MIROIR-1). `Projects` and `Repositories` call
 * `changed`; a handler that throws is logged, the others still run.
 */
@Injectable()
export class ProjectChanges {
  private readonly handlers = new Set<ProjectsChangedHandler>();

  constructor(@InjectPinoLogger(ProjectChanges.name) private readonly logger: PinoLogger) {}

  /** Calls `handler` after each change of a Pilote's Projets; returns its removal. */
  onChanged(handler: ProjectsChangedHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** `pilotId`'s Projets changed, the change committed. */
  changed(pilotId: string): void {
    for (const handler of this.handlers) {
      try {
        handler(pilotId);
      } catch (error) {
        this.logger.error({ err: error }, 'projects changed hook failed');
      }
    }
  }
}
