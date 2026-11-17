import { createHmac, timingSafeEqual } from 'node:crypto';
import { type AgentSession, type ConfirmPairing, PAIRING_PROOF_LABELS, type RunnerPairing, VAULT_WRAP_INFO, vaultWrapAad, zAgentSession, zTestingSmoke } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { conflict, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Transactions } from '../realtime/transactions.js';
import { RunnerLinks } from '../runners/link/runner-links.service.js';
import { Public } from '../scope/public.decorator.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { SessionsService } from '../sessions/sessions.service.js';
import type { SmokeLink } from './fake-smoke.js';
import { FAKES, type Fakes } from './fakes.js';
import { SMOKE_REPOSITORY } from './scenarios/smoke.js';
import { deviceProof, newVaultKey, publicKeyOf, sealWrap } from './smoke-keys.js';

export class TestingSmokeDto extends createZodDto(zTestingSmoke) {}
export class TestingSmokeSessionDto extends createZodDto(zAgentSession) {}

/** The Session the smoke test starts: a Moteur the fake stands for, no Étape. */
const SMOKE_SESSION = { role: 'code', engine: 'claude-code', model: 'claude-opus-5-5', title: 'Smoke test', branch: 'smoke/session' } as const;

/**
 * The page's part of the smoke test of the compiled Runner (RUNNER-14,
 * `apps/runner/smoke/smoke.sh`), for the link the scenario `smoke` drew,
 * named by its `confirmToken`:
 *
 * - `POST /api/testing/smoke/confirm`: once the binary sent its pairing,
 *   checks its proof and confirms with the Appareil's proof and the vault
 *   key wrapped for the Runner and the Appareil, as the page does
 *   (`RunnerLinks.confirm`, 204); 409 `testing.smoke-not-pending` before.
 * - `POST /api/testing/smoke/sessions`: starts a Session on the scenario's
 *   Projet (`SessionsService.start`, 201), which the Runner runs.
 *
 * 404 `testing.smoke-unknown` for another token. Mounted outside production
 * only (`TestingModule`); public, as the scenarios.
 */
@Public()
@Controller('testing/smoke')
export class TestingSmokeController {
  constructor(
    @Inject(FAKES) private readonly fakes: Fakes,
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  @Post('confirm')
  @HttpCode(204)
  async confirm(@Body() { confirmToken }: TestingSmokeDto): Promise<void> {
    const link = this.linkOf(confirmToken);
    const row = await this.prisma.unscoped.runnerLinkCode.findUnique({
      where: { id: link.linkCodeId },
      select: { state: true, runnerPairing: true, runnerId: true, lastSeq: true },
    });
    if (row?.state !== 'pending' || row.runnerPairing === null || row.runnerId === null) {
      throw conflict('testing.smoke-not-pending', MESSAGES['testing.smoke-not-pending']);
    }
    const runner = row.runnerPairing as RunnerPairing;
    const runnerPublicKey = Buffer.from(runner.runnerPublicKey, 'base64url');
    const devicePublicKey = publicKeyOf(link.devicePrivateKey);
    // The page checks the Runner's proof before it confirms (US-2).
    if (!this.runnerProofHolds(link, runner, runnerPublicKey, devicePublicKey)) {
      throw unprocessable('testing.smoke-proof-invalid', MESSAGES['testing.smoke-proof-invalid']);
    }
    const vaultKey = newVaultKey();
    const pairing: ConfirmPairing = {
      proof: deviceProof(link.secret, link.shortId, devicePublicKey, runnerPublicKey),
      vaultKeyVersion: 1,
      runnerVaultWrap: sealWrap(link.devicePrivateKey, runnerPublicKey, vaultKey, VAULT_WRAP_INFO, vaultWrapAad(row.runnerId, 1)),
      deviceVaultWrap: sealWrap(link.devicePrivateKey, devicePublicKey, vaultKey, VAULT_WRAP_INFO, vaultWrapAad(link.deviceId, 1)),
    };
    const links = this.moduleRef.get(RunnerLinks, { strict: false });
    await runInPilotScope(link.pilotId, () => links.confirm(link.pilotId, link.linkCodeId, pairing, Number(row.lastSeq)));
  }

  @Post('sessions')
  @HttpCode(201)
  @ZodResponse({ status: 201, description: 'The Session started on the scenario’s Projet.', type: TestingSmokeSessionDto })
  sessions(@Body() { confirmToken }: TestingSmokeDto): Promise<AgentSession> {
    const link = this.linkOf(confirmToken);
    const sessions = this.moduleRef.get(SessionsService, { strict: false });
    const transactions = this.moduleRef.get(Transactions, { strict: false });
    return runInPilotScope(link.pilotId, () =>
      transactions.run((tx) => sessions.start(tx, { ...SMOKE_SESSION, projectId: link.projectId, base: SMOKE_REPOSITORY.branch })),
    );
  }

  private linkOf(confirmToken: string): SmokeLink {
    const link = this.fakes.smoke.byToken(confirmToken);
    if (!link) throw notFound('testing.smoke-unknown', MESSAGES['testing.smoke-unknown']);
    return link;
  }

  /** HMAC-SHA256(secret, runner label ‖ shortId ‖ the Runner's key ‖ the Appareil's key). */
  private runnerProofHolds(link: SmokeLink, runner: RunnerPairing, runnerPublicKey: Buffer, devicePublicKey: Buffer): boolean {
    const expected = createHmac('sha256', link.secret)
      .update(Buffer.concat([Buffer.from(PAIRING_PROOF_LABELS.runner), Buffer.from(link.shortId, 'ascii'), runnerPublicKey, devicePublicKey]))
      .digest();
    const proof = Buffer.from(runner.proof, 'base64url');
    return proof.length === expected.length && timingSafeEqual(proof, expected);
  }
}
