import { EMAIL_LINK_TTL_SECONDS } from '@crewdeck/contracts';

/** The subject, text and HTML of a mail, before its address. */
export interface MailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/**
 * The mail of a sign-in link (CORE-9), in French: the server has no `t()`,
 * its copy lives here as the error messages live in `messages.ts`. The HTML
 * holds the one link, no image and no tracker.
 */
export const signInLinkMail = (url: string): MailContent => {
  const minutes = EMAIL_LINK_TTL_SECONDS / 60;
  const href = escapeHtml(url);
  return {
    subject: 'Ton lien de connexion à Crewdeck',
    text: `Clique sur ce lien pour te connecter à Crewdeck : ${url}\n\nIl est valable ${minutes} minutes et ne sert qu’une fois. Si tu n’as rien demandé, ignore ce message.\n`,
    html: [
      '<!doctype html>',
      '<html lang="fr"><head><meta charset="utf-8"><title>Ton lien de connexion à Crewdeck</title></head><body>',
      `<p>Clique sur ce lien pour te connecter à Crewdeck : <a href="${href}">${href}</a></p>`,
      `<p>Il est valable ${minutes} minutes et ne sert qu’une fois. Si tu n’as rien demandé, ignore ce message.</p>`,
      '</body></html>',
    ].join('\n'),
  };
};
