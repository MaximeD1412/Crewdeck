// Boot order: the tokens (the fonts, the document's ground), the Skin, the dispatcher, the router.
import '@crewdeck/skin-passerelle/tokens.css';
import '@crewdeck/skin-passerelle/fonts.css';
import '@crewdeck/skin-passerelle/document.css';
import { boot } from './app.js';

void boot({ root: document.querySelector<HTMLElement>('#app') ?? document.body });
