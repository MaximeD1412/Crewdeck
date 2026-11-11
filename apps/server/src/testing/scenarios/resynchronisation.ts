import { defineScenario } from './define.js';
import { signInPilot } from './sign-in.js';

/**
 * The Resynchronisation (`design/screens.json`: `a-toi`, state
 * `resynchronisation`): its Banner and the Cadre's « Resynchronisation… »
 * status, around the library page opened on MenuItem (the one on Banner
 * shows its own examples); the « À toi » page under
 * them is ATOI-1's. The end-to-end test and the captures cut the socket
 * themselves (`apps/web/e2e/socket.ts`). The Pilote signed in.
 */
export const resynchronisation = defineScenario({
  name: 'a-toi-resynchronisation',
  path: '/parametres/composants?c=MenuItem',
  seed: signInPilot,
});
