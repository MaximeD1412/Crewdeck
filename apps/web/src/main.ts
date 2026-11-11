// Boot order: the tokens (the fonts, the document's ground), the core's
// crewdeck-confirm (its tag taken before any Skin's module evaluates), the
// Skin, the dispatcher, the router.
import '@crewdeck/skin-passerelle/tokens.css';
import '@crewdeck/skin-passerelle/fonts.css';
import '@crewdeck/skin-passerelle/document.css';
import './dialogs/confirm.js';
import { boot } from './app.js';

// The end-to-end specs' harness, never in the production build.
if (import.meta.env.DEV) void import('./testing/harness.js').then(({ installHarness }) => installHarness());

void boot({ root: document.querySelector<HTMLElement>('#app') ?? document.body });
