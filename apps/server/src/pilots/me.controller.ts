import { type Me, zMe } from '@crewdeck/contracts';
import { Controller, Get, Module } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { currentPilotId } from '../scope/scope.context.js';

export class MeDto extends createZodDto(zMe) {}

/** `GET /api/me`: who is signed in, which the page asks first. */
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The signed-in Pilote.', type: MeDto })
  async me(): Promise<Me> {
    const pilot = await this.prisma.scoped.pilot.findUnique({
      where: { id: currentPilotId() },
      select: { id: true, login: true, avatarUrl: true, timeZone: true },
    });
    if (!pilot) throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
    return pilot;
  }
}

@Module({ controllers: [MeController] })
export class PilotsModule {}
