import { zEmailLinkVerified, zMe, type EmailLinkRequest, type EmailLinkVerified, type EmailLinkVerify, type Me } from '@crewdeck/contracts';
import { ApiError, call, request } from './request.js';

/** The Pilote signed in (`GET /api/me`), or `null` when the page has no session. */
export const me = async (): Promise<Me | null> => {
  try {
    return await request('GET', '/api/me', zMe);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
};

/** Ends the page's session (`POST /api/auth/logout`). */
export const logout = (): Promise<void> => request('POST', '/api/auth/logout');

/** Mails a sign-in link to `email` that comes back to `next` (`POST /api/auth/email`, 204 known address or not). */
export const requestLink = async (email: string, next: string): Promise<void> => {
  const body: EmailLinkRequest = { email, next };
  await call('POST', '/api/auth/email', body);
};

/** Signs in with a link's token (`POST /api/auth/email/verify`): the session's cookie set, the page to go to. */
export const verifyLink = async (token: string, timeZone: string): Promise<EmailLinkVerified> => {
  const body: EmailLinkVerify = { token, timeZone };
  // `call` reads the answer with the schema.
  return (await call('POST', '/api/auth/email/verify', body, zEmailLinkVerified)) as EmailLinkVerified;
};
