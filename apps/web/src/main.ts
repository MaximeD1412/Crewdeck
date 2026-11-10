// Boot order: the tokens (and the fonts), the Skin, the dispatcher, the router.
import '@crewdeck/skin-passerelle/tokens.css';
import '@crewdeck/skin-passerelle/fonts.css';
import { boot } from './app.js';

void boot({ root: document.querySelector<HTMLElement>('#app') ?? document.body });
