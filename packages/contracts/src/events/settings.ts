import { z } from 'zod';
import { type ProjectSettings, zProjectSettings } from '../api/project-settings.js';
import { type AccountSettings, zAccountSettings } from '../api/settings.js';
import { registerEventPayload } from './index.js';

/**
 * `settings.upserted`: the Paramètres of the account as `GET /api/settings`
 * returns them, on each change; or `{ projectSettings }`, those of one Projet
 * as `GET /api/projects/:id/settings` returns them, when they change (theirs,
 * or the account's they inherit).
 */
export const zSettingsEventPayload = registerEventPayload(
  'settings',
  z.union([z.strictObject({ projectSettings: zProjectSettings }), zAccountSettings]),
);

declare module './index.js' {
  interface EventPayloads {
    settings: AccountSettings | { projectSettings: ProjectSettings };
  }
}
