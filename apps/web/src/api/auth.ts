import { zMe, type Me } from '@crewdeck/contracts';
import { ApiError, request } from './request.js';

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
