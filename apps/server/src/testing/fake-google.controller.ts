import { Controller, Get, Inject, Query, Redirect } from '@nestjs/common';
import { notFound } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { Public } from '../scope/public.decorator.js';
import { FAKES, type Fakes } from './fakes.js';

/**
 * Google's authorize page, faked at `/fake-google` (outside `/api`): it
 * chooses the seeded account at once and goes back to `redirect_uri` with a
 * code and the state, or with `error=access_denied` when no account is
 * seeded (`FakeGoogle`).
 */
@Public()
@Controller('fake-google')
export class FakeGoogleController {
  constructor(@Inject(FAKES) private readonly fakes: Fakes) {}

  @Get('authorize')
  @Redirect()
  authorize(
    @Query('redirect_uri') redirectUri: string | undefined,
    @Query('state') state: string | undefined,
    @Query('code_challenge') codeChallenge: string | undefined,
    @Query('nonce') nonce: string | undefined,
  ): { url: string; statusCode: number } {
    if (redirectUri === undefined || !URL.canParse(redirectUri)) throw notFound('fake-google.not-found', MESSAGES['fake-google.not-found']);
    const url = new URL(redirectUri);
    const code = this.fakes.google.authorize({ codeChallenge: codeChallenge ?? '', nonce: nonce ?? '', redirectUri });
    if (code === undefined) url.searchParams.set('error', 'access_denied');
    else url.searchParams.set('code', code);
    url.searchParams.set('state', state ?? '');
    return { url: url.toString(), statusCode: 302 };
  }
}
