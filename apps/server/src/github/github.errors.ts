import { AppError, conflict, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';

/** 409: the PR's head is no longer the SHA the gate judged (ADR 0002). */
export const headMoved = (): AppError => conflict('github.head-moved', MESSAGES['github.head-moved']);

/** 422: a branch protection refuses a write of the server; the change goes as a PR instead (ADR 0002). */
export const branchProtected = (): AppError => unprocessable('github.branch-protected', MESSAGES['github.branch-protected']);

/** 422: the repository's `.process.json` is not JSON. */
export const processJsonInvalid = (): AppError => unprocessable('github.process-json-invalid', MESSAGES['github.process-json-invalid']);

/** 500: GitHub failed, or refused for a reason the page cannot fix. */
export const githubUnavailable = (): AppError => new AppError(500, 'github.unavailable', MESSAGES['github.unavailable']);
