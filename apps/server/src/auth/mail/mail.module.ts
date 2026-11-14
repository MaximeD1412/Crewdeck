import { type DynamicModule, Module } from '@nestjs/common';
import { type Env, usesFakes } from '../../config/env.js';
import { MAILER, SmtpMailer } from './mailer.js';
import { MemoryMailer } from './memory-mailer.js';

/**
 * `MAILER` for every module: `SmtpMailer` on `SMTP_URL`, else `MemoryMailer`
 * (development, the tests: nothing leaves the machine). With
 * `CREWDECK_FAKES=1` this module is empty and `TestingModule` binds `MAILER`
 * to its `FakeMailer`: nothing here imports `src/testing/`.
 */
@Module({})
export class MailModule {
  static forRoot(env: Env): DynamicModule {
    if (usesFakes(env)) return { module: MailModule };
    const mailer = env.SMTP_URL ? new SmtpMailer(env.SMTP_URL, env.MAIL_FROM ?? '') : new MemoryMailer();
    return { module: MailModule, global: true, providers: [{ provide: MAILER, useValue: mailer }], exports: [MAILER] };
  }
}
