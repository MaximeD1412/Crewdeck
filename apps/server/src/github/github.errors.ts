import { AppError, conflict, notFound, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';

/** 409: the PR's head is no longer the SHA the gate judged (ADR 0002). */
export const headMoved = (): AppError => conflict('github.head-moved', MESSAGES['github.head-moved']);

/** 422: a branch protection refuses a write of the server; the change goes as a PR instead (ADR 0002). */
export const branchProtected = (): AppError => unprocessable('github.branch-protected', MESSAGES['github.branch-protected']);

/** 404: GitHub has no such installation any more (uninstalled, its webhook lost): not a failure to retry. */
export const installationGone = (): AppError => notFound('github.installation-gone', MESSAGES['github.installation-gone']);

/** 422: the repository's `.process.json` is not JSON. */
export const processJsonInvalid = (): AppError => unprocessable('github.process-json-invalid', MESSAGES['github.process-json-invalid']);

/** 401: GitHub refuses a user grant (a stale code, a refresh token used, expired or revoked): only signing in again fixes it. */
export const userTokenRefused = (): AppError => new AppError(401, 'github.user-token-refused', MESSAGES['github.user-token-refused']);

/** 500: GitHub failed, or refused for a reason the page cannot fix. */
export const githubUnavailable = (): AppError => new AppError(500, 'github.unavailable', MESSAGES['github.unavailable']);
