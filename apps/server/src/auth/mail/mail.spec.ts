import { createTransport } from 'nodemailer';
import { SmtpMailer } from './mailer.js';
import { MemoryMailer } from './memory-mailer.js';
import { signInLinkMail } from './sign-in-link.js';

const URL_OF_LINK = 'https://crewdeck.example/connexion/lien#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MAIL = { to: 'pilote@example.com', subject: 'Sujet', text: 'Texte', html: '<p>Texte</p>' };

describe('signInLinkMail', () => {
  it('says what the link does, for how long, and what to do when nothing was asked', () => {
    const mail = signInLinkMail(URL_OF_LINK);

    expect(mail.subject).toBe('Ton lien de connexion à Crewdeck');
    expect(mail.text).toContain(`Clique sur ce lien pour te connecter à Crewdeck : ${URL_OF_LINK}`);
    expect(mail.text).toContain('Il est valable 15 minutes et ne sert qu’une fois. Si tu n’as rien demandé, ignore ce message.');
  });

  it('holds one link in its HTML, and neither an image nor anything loaded from afar', () => {
    const { html } = signInLinkMail(URL_OF_LINK);

    expect([...html.matchAll(/<a\s/g)]).toHaveLength(1);
    expect(html).toContain(`<a href="${URL_OF_LINK}">`);
    expect(html).not.toMatch(/<img|<link|<script|<style|url\(|src=/i);
  });

  it('escapes the URL in its HTML', () => {
    expect(signInLinkMail('https://crewdeck.example/"><b>').html).not.toContain('"><b>');
  });
});

describe('SmtpMailer', () => {
  it('sends each mail from MAIL_FROM, with its text and its HTML', async () => {
    const transport = createTransport({ jsonTransport: true });
    const sendMail = vi.spyOn(transport, 'sendMail');
    const mailer = new SmtpMailer('smtp://relay.example:587', 'Crewdeck <connexion@crewdeck.example>', transport);

    await mailer.send(MAIL);

    const message = JSON.parse(String((await sendMail.mock.results[0]?.value as { message: string }).message)) as Record<string, unknown>;
    expect(message).toMatchObject({
      from: { address: 'connexion@crewdeck.example', name: 'Crewdeck' },
      to: [{ address: 'pilote@example.com', name: '' }],
      subject: 'Sujet',
      text: 'Texte',
      html: '<p>Texte</p>',
    });
  });

  it('rejects when the relay cannot be reached', async () => {
    const mailer = new SmtpMailer('smtp://127.0.0.1:1', 'connexion@crewdeck.example');

    await expect(mailer.send(MAIL)).rejects.toThrow();
  });
});

describe('MemoryMailer', () => {
  it('keeps the mails of each address, newest first, until reset', async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ ...MAIL, subject: 'Premier' });
    await mailer.send({ ...MAIL, to: 'autre@example.com' });
    await mailer.send({ ...MAIL, subject: 'Second' });

    expect(mailer.sentTo('pilote@example.com').map((mail) => mail.subject)).toEqual(['Second', 'Premier']);
    mailer.reset();
    expect(mailer.sentTo('pilote@example.com')).toEqual([]);
  });

  it('refuses the next mail only, once told to fail', async () => {
    const mailer = new MemoryMailer();
    mailer.failNext(new Error('550'));

    await expect(mailer.send(MAIL)).rejects.toThrow('550');
    await mailer.send(MAIL);
    expect(mailer.sentTo('pilote@example.com')).toHaveLength(1);
  });
});
