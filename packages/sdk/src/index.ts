/**
 * What a Skin may import (ADR 0006): the Composants' declarations,
 * `defineSkin`, `emitAction`, the bridge's contract, `t()` and the formatters.
 * A Skin never imports `@crewdeck/contracts` itself.
 */
export * from '@crewdeck/contracts/composants';
export { emitAction } from './actions.js';
export type { Bridge } from './bridge.js';
export * from './format.js';
export { fr, type MessageKey } from './i18n/fr.js';
export { t, type MessageParams } from './i18n/t.js';
export { BREAKPOINT_PX, defineSkin, type Skin, type SkinSpec, type SkinTarget } from './skin.js';

export const version = '0.0.0';
