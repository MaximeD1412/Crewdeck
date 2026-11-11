import { t } from '@crewdeck/sdk';
import type { StoreState } from './store.js';

/**
 * Why an Action sensible is unavailable (ADR 0007): during the
 * Resynchronisation, until the state is sure again; `null` once live. Every
 * view rendering one gives it to its Composant as the disabled reason, and
 * the dispatcher refuses the action with the same rule (CORE-7).
 */
export const sensitiveBlockedReason = (state: Pick<StoreState, 'connection'>): string | null =>
  state.connection === 'live' ? null : t('resync.sensitiveUnavailable');
