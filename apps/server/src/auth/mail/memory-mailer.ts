import type { Mail, Mailer } from './mailer.js';

/** A mail kept by `MemoryMailer`, with when it was "sent". */
export interface SentMail extends Mail {
  readonly sentAt: string;
}

/**
 * The mails kept in this process's memory, never sent: the `MAILER` where no
 * `SMTP_URL` is set (development, the unit and integration tests), and the
 * base of the fakes' `FakeMailer` (`GET /api/testing/mails`). Nothing leaves
 * the machine.
 */
export class MemoryMailer implements Mailer {
  private readonly sent: SentMail[] = [];
  private failure: Error | undefined;

  async send(mail: Mail): Promise<void> {
    const failure = this.failure;
    this.failure = undefined;
    if (failure) throw failure;
    this.sent.push({ to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, sentAt: new Date().toISOString() });
  }

  /** The mails kept for `to`, newest first. */
  sentTo(to: string): SentMail[] {
    return this.sent.filter((mail) => mail.to === to).reverse();
  }

  /** The next `send` rejects with `error`, as a transport that refuses the mail. */
  failNext(error: Error): void {
    this.failure = error;
  }

  /** Forgets every mail. */
  reset(): void {
    this.sent.length = 0;
    this.failure = undefined;
  }
}
