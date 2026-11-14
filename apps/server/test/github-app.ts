import { generateKeyPairSync, randomBytes } from 'node:crypto';

let privateKey: string | undefined;

/**
 * A private key generated for the run (PKCS#1, as GitHub hands it out):
 * never a committed key, never a real App's.
 */
export const testPrivateKey = (): string => {
  privateKey ??= generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  }).privateKey;
  return privateKey;
};

/** The variables of a GitHub App made up for the tests, as the server's `.env` has them. */
export const githubAppEnv = (): Record<string, string> => ({
  GITHUB_APP_ID: '4242',
  GITHUB_APP_PRIVATE_KEY: testPrivateKey(),
  GITHUB_APP_CLIENT_ID: 'Iv23-test-client',
  GITHUB_APP_CLIENT_SECRET: 'test-client-secret',
  GITHUB_APP_SLUG: 'crewdeck-test',
  GITHUB_WEBHOOK_SECRET: 'test-webhook-secret-not-a-real-one',
});

/** The sign-in's keys (CORE-4), drawn for the run, as the server's `.env` has them (base64). */
export const authKeysEnv = (): Record<string, string> => ({
  GITHUB_TOKEN_KEY: randomBytes(32).toString('base64'),
  SESSION_SECRET: randomBytes(32).toString('base64'),
});

/** The mail of the sign-in by email (CORE-9), made up for the tests: a relay nobody answers. */
export const mailEnv = (): Record<string, string> => ({
  SMTP_URL: 'smtps://crewdeck:test-password@smtp.mail.invalid:465',
  MAIL_FROM: 'Crewdeck <connexion@crewdeck.example>',
});
