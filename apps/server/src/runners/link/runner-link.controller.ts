import {
  type RunnerLink,
  type RunnerLinkAccepted,
  type RunnerLinkCodeCreated,
  type RunnerLinkConfirmed,
  type RunnerLinkStatus,
  zId,
  zRunnerLinkAccepted,
  zRunnerLinkCodeCreate,
  zRunnerLinkCodeCreated,
  zRunnerLinkConfirm,
  zRunnerLinkConfirmed,
  zRunnerLinkFailure,
  zRunnerLinkPairing,
  zRunnerLinkReject,
  zRunnerLinkRequest,
  zRunnerLinkStatus,
} from '@crewdeck/contracts';
import { Body, Controller, Get, HttpCode, Inject, Injectable, type OnModuleInit, Param, Post, Req } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { type AuthRequest } from '../../auth/auth.request.js';
import { namedDevice } from '../../devices/devices.controller.js';
import { notFound } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../../realtime/state-contributors.js';
import type { Tx } from '../../realtime/transactions.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { Public } from '../../scope/public.decorator.js';
import { LINK_VIEW, toRunnerLink } from './link-code.view.js';
import { RunnerLinkLimiter } from './link-limiter.js';
import { RunnerLinks } from './runner-links.service.js';

export class RunnerLinkCodeCreateDto extends createZodDto(zRunnerLinkCodeCreate) {}
export class RunnerLinkCodeCreatedDto extends createZodDto(zRunnerLinkCodeCreated) {}
export class RunnerLinkConfirmDto extends createZodDto(zRunnerLinkConfirm) {}
export class RunnerLinkConfirmedDto extends createZodDto(zRunnerLinkConfirmed) {}
export class RunnerLinkRejectDto extends createZodDto(zRunnerLinkReject) {}
export class RunnerLinkRequestDto extends createZodDto(zRunnerLinkRequest) {}
export class RunnerLinkAcceptedDto extends createZodDto(zRunnerLinkAccepted) {}
export class RunnerLinkPairingDto extends createZodDto(zRunnerLinkPairing) {}
export class RunnerLinkFailureDto extends createZodDto(zRunnerLinkFailure) {}
export class RunnerLinkStatusDto extends createZodDto(zRunnerLinkStatus) {}

/** What the controller reads of Express's request: the client's IP (`trust proxy`, `mountApi`). */
interface Request {
  readonly ip?: string;
}

/** A code's id from the path: one that is not an id is no code at all, 404. */
const codeId = (value: string): string => {
  const parsed = zId.safeParse(value);
  if (!parsed.success) throw notFound('runner.link-code-unknown', MESSAGES['runner.link-code-unknown']);
  return parsed.data;
};

/**
 * The page's side of the link (session): draw a code for its Appareil,
 * confirm the Runner that linked with it, or reject it when its proof is
 * wrong.
 */
@Controller('runner/link-codes')
export class RunnerLinkCodesController {
  constructor(private readonly links: RunnerLinks) {}

  @Post()
  @HttpCode(201)
  @ZodResponse({ status: 201, description: 'The new code, without its secret.', type: RunnerLinkCodeCreatedDto })
  create(@Req() request: AuthRequest, @Body() { pairing }: RunnerLinkCodeCreateDto): Promise<RunnerLinkCodeCreated> {
    return this.links.create(currentPilotId(), pairing, namedDevice(request));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Runner linked, the previous one revoked.', type: RunnerLinkConfirmedDto })
  async confirm(@Param('id') id: string, @Body() { pairing, seq }: RunnerLinkConfirmDto): Promise<RunnerLinkConfirmed> {
    return { runner: await this.links.confirm(currentPilotId(), codeId(id), pairing, seq) };
  }

  @Post(':id/reject')
  @HttpCode(204)
  async reject(@Param('id') id: string, @Body() { seq }: RunnerLinkRejectDto): Promise<void> {
    await this.links.reject(currentPilotId(), codeId(id), seq);
  }
}

/**
 * The binary's and `install.sh`'s side (no session, ADR 0004): link with the
 * short id, send the Runner's pairing, poll the link, report an unsupported
 * system. The attempts with a short id are counted by IP.
 */
@Public()
@Controller('runner')
export class RunnerLinkController {
  constructor(
    private readonly links: RunnerLinks,
    private readonly limiter: RunnerLinkLimiter,
  ) {}

  @Post('link')
  @HttpCode(202)
  @ZodResponse({ status: 202, description: 'The code is pending the page’s confirmation.', type: RunnerLinkAcceptedDto })
  link(@Req() request: Request, @Body() body: RunnerLinkRequestDto): Promise<RunnerLinkAccepted> {
    this.limiter.hit(request.ip ?? 'unknown');
    return this.links.link(body);
  }

  @Post('link/:linkId/pairing')
  @HttpCode(204)
  async pairing(@Param('linkId') linkId: string, @Body() { pairing }: RunnerLinkPairingDto): Promise<void> {
    await this.links.pairing(codeId(linkId), pairing);
  }

  @Get('link/:linkId')
  @ZodResponse({ status: 200, description: 'Pending, linked (the token once) or failed.', type: RunnerLinkStatusDto })
  status(@Param('linkId') linkId: string): Promise<RunnerLinkStatus> {
    return this.links.status(codeId(linkId));
  }

  @Post('link-failures')
  @HttpCode(204)
  async failure(@Req() request: Request, @Body() body: RunnerLinkFailureDto): Promise<void> {
    this.limiter.hit(request.ip ?? 'unknown');
    await this.links.failure(body);
  }
}

/** The `runner-link` slice of `GET /api/state`: the Pilote's last code, `null` before any. */
@Injectable()
export class RunnerLinkState implements StateContributor<'runner-link'>, OnModuleInit {
  readonly key = 'runner-link';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx): Promise<RunnerLink | null> {
    const row = await tx.runnerLinkCode.findFirst({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: LINK_VIEW });
    return row ? toRunnerLink(row) : null;
  }
}
