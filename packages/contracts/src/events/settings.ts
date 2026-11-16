import { type AccountSettings, zAccountSettings } from '../api/settings.js';
import { registerEventPayload } from './index.js';

/** `settings.upserted`: the Paramètres of the account as `GET /api/settings` returns them, on each change. */
export const zSettingsEventPayload = registerEventPayload('settings', zAccountSettings);

declare module './index.js' {
  interface EventPayloads {
    settings: AccountSettings;
  }
}
