import { DEVICE_HEADER } from '@crewdeck/contracts';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { type AuthRequest, headerOf } from '../auth/auth.request.js';
import { unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { deviceIdOf, deviceNotTrusted } from './devices.service.js';

/** The request of a route a trusted Appareil calls, once its header is checked. */
export type TrustedDeviceRequest = AuthRequest & { trustedDeviceId?: string };

const deviceRevoked = () => unprocessable('devices.revoked', MESSAGES['devices.revoked']);

/** The state of the Pilote's Appareil the page named in `X-Crewdeck-Device`, `undefined` for none of theirs. */
const namedState = async (prisma: PrismaService, request: AuthRequest): Promise<{ id: string; state: string } | undefined> => {
  const id = deviceIdOf(headerOf(request, DEVICE_HEADER.toLowerCase()));
  const principal = request.principal;
  if (!id || principal?.kind !== 'pilot') return undefined;
  const device = await runInPilotScope(principal.pilotId, () => prisma.scoped.device.findUnique({ where: { id }, select: { state: true } }));
  return device ? { id, state: device.state } : undefined;
};

/**
 * A route that serves a wrap or a stored ciphertext (E2E-4): a page that
 * names a revoked Appareil gets 422 `devices.revoked` at once, before the
 * rotation. The header is the page's own word: an honest page stops there,
 * the rotation protects against the others.
 */
@Injectable()
export class NotRevokedDeviceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const named = await namedState(this.prisma, context.switchToHttp().getRequest<AuthRequest>());
    if (named?.state === 'revoked') throw deviceRevoked();
    return true;
  }
}

/** The vault's routes for a page: its header names a trusted Appareil of the Pilote, else 422 `devices.revoked` or `devices.not-trusted`. */
@Injectable()
export class TrustedDeviceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TrustedDeviceRequest>();
    const named = await namedState(this.prisma, request);
    if (named?.state === 'revoked') throw deviceRevoked();
    if (named?.state !== 'trusted') throw deviceNotTrusted();
    request.trustedDeviceId = named.id;
    return true;
  }
}
