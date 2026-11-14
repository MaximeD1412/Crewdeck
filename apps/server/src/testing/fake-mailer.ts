import { MemoryMailer } from '../auth/mail/memory-mailer.js';
import type { Fake } from './fakes.js';

export type { SentMail } from '../auth/mail/memory-mailer.js';

/**
 * The fakes' mail (`Fakes.mail`), bound to `MAILER` by `TestingModule`: the
 * mails a scenario or an end-to-end test reads back (`GET /api/testing/mails`).
 * Outside the fakes, `MemoryMailer` stands in where no `SMTP_URL` is set:
 * `main.ts` never loads `src/testing/`.
 */
export class FakeMailer extends MemoryMailer implements Fake {}
