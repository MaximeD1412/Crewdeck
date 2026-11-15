import { type Repository, zRepository } from '../api/projects.js';
import { registerEventPayload } from './index.js';

/**
 * `repository.upserted`: a Dépôt GitHub the installation reaches, when it is
 * added, changes or is followed; `repository.removed` once the installation
 * no longer reaches it.
 */
export const zRepositoryEventPayload = registerEventPayload('repository', zRepository);

declare module './index.js' {
  interface EventPayloads {
    repository: Repository;
  }
}
