import { z } from 'zod';
import { zBrowserPairing, zConfirmPairing, zLinkedPairing, zRunnerPairing } from '../keys/pairing.js';
import { zRunnerArch, zRunnerOs } from '../runner/hello.js';
import { zId, zInstant } from '../values.js';
import { withSeq } from './commands.js';
import { zRunner } from './runner.js';

/**
 * Linking a Runner (ADR 0003, ADR 0004, RUNNER-3). The page draws a link code
 * `<shortId>-<secret>`: the short id the server knows, the secret only the
 * page and the Runner ever see. The server routes the pairings of
 * `keys/pairing.ts` (E2E-2), which it cannot forge without the secret, and
 * creates the Runner once the page confirmed it.
 */

/** Crockford's base32 alphabet, uppercase (`I`, `L`, `O` and `U` excluded). */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD = '[0-9A-HJKMNP-TV-Z]';

/** The short id: 4 Crockford characters (about a million), unique among the live codes. */
export const LINK_CODE_SHORT_ID_LENGTH = 4;
/** The secret: 26 Crockford characters, 128 bits, drawn by the page, never sent to the server. */
export const LINK_CODE_SECRET_LENGTH = 26;
/** How long a code lives, from its creation. */
export const LINK_CODE_TTL_SECONDS = 10 * 60;
/** How often the Runner asks whether the page confirmed its link. */
export const LINK_POLL_SECONDS = 2;
/** The attempts `POST /api/runner/link` (and `link-failures`) accepts per minute from one IP. */
export const LINK_ATTEMPTS_PER_MINUTE = 10;

export const zShortId = z.string().regex(new RegExp(`^${CROCKFORD}{${LINK_CODE_SHORT_ID_LENGTH}}$`));
export const zLinkCode = z.string().regex(new RegExp(`^${CROCKFORD}{${LINK_CODE_SHORT_ID_LENGTH}}-${CROCKFORD}{${LINK_CODE_SECRET_LENGTH}}$`));

/** The two parts of a code as the Pilote pasted it (any case), `null` when it is not one. */
export const splitLinkCode = (code: string): { shortId: string; secret: string } | null => {
  const parsed = zLinkCode.safeParse(code.trim().toUpperCase());
  if (!parsed.success) return null;
  const [shortId, secret] = parsed.data.split('-') as [string, string];
  return { shortId, secret };
};

/** `waiting` for a Runner, `pending` the page's confirmation, then `linked`, `failed` or `expired`. */
export const LINK_CODE_STATES = ['waiting', 'pending', 'linked', 'failed', 'expired'] as const;
export const zLinkCodeState = z.enum(LINK_CODE_STATES);
export type LinkCodeState = z.infer<typeof zLinkCodeState>;

/** Why a code did not link a Runner: the page's Banner and the binary's message say it. */
export const LINK_FAILURE_REASONS = ['expired', 'already-used', 'unsupported-system', 'no-engine', 'pairing-mismatch', 'device-not-trusted'] as const;
export const zLinkFailureReason = z.enum(LINK_FAILURE_REASONS);
export type LinkFailureReason = z.infer<typeof zLinkFailureReason>;

/**
 * `POST /api/runner/link-codes` (session): the page's pairing; a new code
 * expires the Pilote's code still waiting. The Appareil the page names in
 * `X-Crewdeck-Device` is kept when its public key is the pairing's; else a
 * new one is created, `pending`.
 */
export const zRunnerLinkCodeCreate = z.object({ pairing: zBrowserPairing });
export type RunnerLinkCodeCreate = z.infer<typeof zRunnerLinkCodeCreate>;

/** Its answer, 201: the code without its secret, which never left the page, and the page's Appareil. */
export const zRunnerLinkCodeCreated = z.object({ id: zId, shortId: zShortId, expiresAt: zInstant, deviceId: zId });
export type RunnerLinkCodeCreated = z.infer<typeof zRunnerLinkCodeCreated>;

/**
 * `POST /api/runner/link` (no session; the binary): the short id of the code
 * and the machine of the Runner, with the Moteurs it found on `PATH`.
 */
export const zRunnerLinkRequest = z.object({
  shortId: zShortId,
  machine: z.string().min(1).max(255),
  os: zRunnerOs,
  arch: zRunnerArch,
  wsl: z.boolean(),
  runnerVersion: z.string().min(1).max(64),
  engines: z.array(z.string().min(1).max(64)).max(16),
});
export type RunnerLinkRequest = z.infer<typeof zRunnerLinkRequest>;

/** Its answer, 202: the link the binary polls, and the page's pairing. */
export const zRunnerLinkAccepted = z.object({ linkId: zId, browserPairing: zBrowserPairing });
export type RunnerLinkAccepted = z.infer<typeof zRunnerLinkAccepted>;

/** `POST /api/runner/link/:linkId/pairing` (no session; the binary, right after): the Runner's pairing. */
export const zRunnerLinkPairing = z.object({ pairing: zRunnerPairing });
export type RunnerLinkPairing = z.infer<typeof zRunnerLinkPairing>;

/** `POST /api/runner/link-failures` (no session; `install.sh`): a system the Runner is not built for, as `uname` named it. */
export const zRunnerLinkFailure = z.object({
  shortId: zShortId,
  reason: z.literal('unsupported-system'),
  os: z.string().min(1).max(64),
  arch: z.string().min(1).max(64),
});
export type RunnerLinkFailure = z.infer<typeof zRunnerLinkFailure>;

/**
 * `POST /api/runner/link-codes/:id/confirm` (session): the page's pairing for
 * the Runner, once it checked the Runner's proof. 422 `devices.not-trusted`
 * (the code then `failed`, `device-not-trusted`) when the Pilote has a vault
 * key and the page's Appareil does not hold it.
 */
export const zRunnerLinkConfirm = withSeq(z.object({ pairing: zConfirmPairing }));
export type RunnerLinkConfirm = z.infer<typeof zRunnerLinkConfirm>;

/** Its answer, 200: the Runner it linked, the previous one revoked. */
export const zRunnerLinkConfirmed = z.object({ runner: zRunner });
export type RunnerLinkConfirmed = z.infer<typeof zRunnerLinkConfirmed>;

/** `POST /api/runner/link-codes/:id/reject` (session): the Runner's proof did not match, the code is `failed`. */
export const zRunnerLinkReject = withSeq(z.object({ reason: z.literal('pairing-mismatch') }));
export type RunnerLinkReject = z.infer<typeof zRunnerLinkReject>;

/**
 * `GET /api/runner/link/:linkId` (no session; the binary, every 2 s):
 * `pending` until the page confirmed; `linked` with the Runner's id, the
 * page's pairing and its token, the token only on the first answer; `failed`
 * with the reason. One object, its fields optional, for the Go types.
 */
export const LINK_STATUS_STATES = ['pending', 'linked', 'failed'] as const;
export const zRunnerLinkStatus = z.object({
  state: z.enum(LINK_STATUS_STATES),
  runnerId: zId.optional(),
  /** The Runner's token, 32 random bytes in base64url: on the first `linked` answer only. */
  token: z.string().min(1).optional(),
  /** The page's proof and the Runner's vault wrap, with the token. */
  pairing: zLinkedPairing.optional(),
  reason: zLinkFailureReason.optional(),
});
export type RunnerLinkStatus = z.infer<typeof zRunnerLinkStatus>;

/**
 * The Pilote's last code as the page sees it: the `runner-link` slice of
 * `GET /api/state` (`null` before any) and the payload of
 * `runner-link.upserted`. Its `runnerPairing` tells the page the Runner is
 * there, waiting for its confirmation; `runnerId`, drawn once a Runner took
 * the code, is the id that Runner will have, which its vault wrap binds.
 */
export const zRunnerLink = z.object({
  id: zId,
  shortId: zShortId,
  state: zLinkCodeState,
  failureReason: zLinkFailureReason.nullable(),
  expiresAt: zInstant,
  runnerId: zId.nullable(),
  runnerPairing: zRunnerPairing.nullable(),
});
export type RunnerLink = z.infer<typeof zRunnerLink>;
