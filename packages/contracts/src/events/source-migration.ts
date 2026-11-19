import { type SourceMigration, zSourceMigration } from '../api/source-migrations.js';
import { registerEventPayload } from './index.js';

/** `source-migration.upserted`: the migration as `GET /api/projects/:id/source-migrations` lists it, on each change of its state or counts. */
export const zSourceMigrationEventPayload = registerEventPayload('source-migration', zSourceMigration);

declare module './index.js' {
  interface EventPayloads {
    'source-migration': SourceMigration;
  }
}
