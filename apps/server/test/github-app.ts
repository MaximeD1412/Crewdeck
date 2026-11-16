import { generateKeyPairSync, randomBytes } from 'node:crypto';
import webpush from 'web-push';

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

/** A VAPID key pair drawn for the run, and a subject that is nobody's, as the server's `.env` has them. */
export const vapidEnv = (): Record<string, string> => {
  const { publicKey, privateKey: vapidPrivateKey } = webpush.generateVAPIDKeys();
  return { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: vapidPrivateKey, VAPID_SUBJECT: 'https://crewdeck.invalid' };
};
