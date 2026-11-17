import { createTransport, type Transporter } from 'nodemailer';

/** One mail: its address, subject, and the same body as text and as HTML. */
export interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** What sends the server's mails (the sign-in links, CORE-9); rejects when the transport refuses one. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** The token of the `Mailer`: `SmtpMailer` with `SMTP_URL`, the fakes' or `MemoryMailer` without it. */
export const MAILER = Symbol('MAILER');

/** The mails through the SMTP relay of `SMTP_URL` (INFRA-14), each from `MAIL_FROM`. */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    transport?: Transporter,
  ) {
    this.transport = transport ?? createTransport(smtpUrl);
  }

  async send({ to, subject, text, html }: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, text, html });
  }
}
