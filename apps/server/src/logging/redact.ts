/**
 * What no server log ever shows (ADR 0003, risk SEC-7), replaced by
 * `REDACT_CENSOR`: the credentials of a request, its body, and the keys
 * that carry a ciphertext, a wrapped key or its wraps, a nonce, an HPKE
 * `enc`, a Runner protocol or relay payload, a token, an email address
 * (CORE-9), or an Idée's sealed fields (its text, its analysis, the reason of
 * its triage), at the top of a log object or one level down.
 */
const SECRET_KEYS = ['ciphertext', 'sealed', 'nameSealed', 'folderSealed', 'wrappedKey', 'wraps', 'enc', 'nonce', 'payload', 'token', 'accessToken', 'refreshToken', 'email', 'text', 'analysis', 'reason'];

export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body',
  // The GitHub OAuth callback's query: its code and state are credentials.
  'req.query.code',
  'req.query.state',
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((key) => `*.${key}`),
];

export const REDACT_CENSOR = '[redacted]';
