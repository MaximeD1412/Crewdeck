import { type EmailLinkVerified, zEmailLinkRequest, zEmailLinkVerified, zEmailLinkVerify } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type Env, isDeployed } from '../../config/env.js';
import { ENV } from '../../config/env.module.js';
import { Public } from '../../scope/public.decorator.js';
import { type AuthRequest, type AuthResponse, headerOf } from '../auth.request.js';
import { SESSION_COOKIE, serializeCookie } from '../cookies.js';
import { SameOriginGuard } from '../same-origin.guard.js';
import { SESSION_TTL_SECONDS } from '../web-sessions.js';
import { EmailLinks } from './email-links.js';

export class EmailLinkRequestDto extends createZodDto(zEmailLinkRequest) {}
export class EmailLinkVerifyDto extends createZodDto(zEmailLinkVerify) {}
export class EmailLinkVerifiedDto extends createZodDto(zEmailLinkVerified) {}

/** What the controller reads of Express's request: the client's IP (`trust proxy`, `mountApi`). */
type Request = AuthRequest & { readonly ip?: string };

/**
 * The sign-in by a link sent by email (US-1, ADR 0014), which is also the
 * sign-up. Called by the page only, signed out: another `Origin` is refused
 * with 401 `auth.origin`, the cookie or not.
 */
@Public()
@UseGuards(SameOriginGuard)
@Controller('auth/email')
export class EmailAuthController {
  private readonly secure: boolean;

  constructor(
    @Inject(ENV) env: Env,
    private readonly links: EmailLinks,
  ) {
    this.secure = isDeployed(env);
  }

  /** `POST /api/auth/email` → 204, whether the address has a Pilote or not: the link is mailed. */
  @Post()
  @HttpCode(204)
  async request(@Req() request: Request, @Body() { email, next }: EmailLinkRequestDto): Promise<void> {
    await this.links.request(email, next, request.ip ?? 'unknown');
  }

  /** `POST /api/auth/email/verify` → 200 and the session's cookie; 422 `auth.link-invalid` for a link unknown, expired or used. */
  @Post('verify')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'Signed in: the cookie is set, the page lands on next.', type: EmailLinkVerifiedDto })
  async verify(
    @Req() request: Request,
    @Res({ passthrough: true }) response: AuthResponse,
    @Body() { token, timeZone }: EmailLinkVerifyDto,
  ): Promise<EmailLinkVerified> {
    const { sessionToken, next } = await this.links.verify(token, timeZone, headerOf(request, 'user-agent'));
    response.appendHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_TTL_SECONDS, path: '/', secure: this.secure }));
    return { next };
  }
}
