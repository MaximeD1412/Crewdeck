import { type TestingMails, zTestingMails, zTestingMailsQuery } from '@crewdeck/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { Public } from '../scope/public.decorator.js';
import { FAKES, type Fakes } from './fakes.js';

export class TestingMailsQueryDto extends createZodDto(zTestingMailsQuery) {}
export class TestingMailsDto extends createZodDto(zTestingMails) {}

/**
 * `GET /api/testing/mails?to=<address>`: the mails the fake mailer kept for
 * that address, newest first; what an end-to-end test opens the link of.
 * Mounted outside production only (`TestingModule`).
 */
@Public()
@Controller('testing/mails')
export class TestingMailsController {
  constructor(@Inject(FAKES) private readonly fakes: Fakes) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The mails of the address, newest first.', type: TestingMailsDto })
  list(@Query() { to }: TestingMailsQueryDto): TestingMails {
    return { items: this.fakes.mail.sentTo(to) };
  }
}
