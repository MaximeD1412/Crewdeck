/**
 * What a Skin may import (ADR 0006): the Composants' declarations,
 * `defineSkin`, `emitAction`, `sensitive()` (an action the core confirms), the
 * bridge's contract, `t()` and the formatters. Never the core's handlers nor
 * its confirmation (`crewdeck-confirm`): a Skin may ask, never confirm.
 * A Skin never imports `@crewdeck/contracts` itself.
 */
export * from '@crewdeck/contracts/composants';
export { emitAction } from './actions.js';
export type { Bridge } from './bridge.js';
export * from './format.js';
export { composantKeys, missingComposantKeys, type ComposantKeys } from './i18n/composants.js';
export { fr, type MessageKey } from './i18n/fr.js';
export { t, type MessageParams } from './i18n/t.js';
export { BREAKPOINT_PX, defineSkin, type Skin, type SkinSpec, type SkinTarget } from './skin.js';

export const version = '0.0.0';
