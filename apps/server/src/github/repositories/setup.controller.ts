import { Controller, Get, Query, Redirect } from '@nestjs/common';
import { Public } from '../../scope/public.decorator.js';

/** Where the App's Setup URL sends the browser back, by the `state` of the install link. */
export const setupRedirect = (state: string | undefined): string => (state === 'demarrage' ? '/demarrage' : '/projets/ajouter');

/**
 * `GET /api/github/setup?installation_id&setup_action&state`: the App's
 * Setup URL, where GitHub sends the browser after an installation or its
 * update. It records nothing (the webhook does, ADR 0002) and only sends the
 * Pilote back to the picker they left: `/demarrage` or `/projets/ajouter`,
 * whose own guard asks for the session.
 */
@Public()
@Controller('github')
export class GitHubSetupController {
  @Get('setup')
  @Redirect()
  setup(@Query('state') state?: string): { url: string; statusCode: number } {
    return { url: setupRedirect(state), statusCode: 302 };
  }
}
