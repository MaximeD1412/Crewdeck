import { z } from 'zod';

/** An error's code: `<module>.<case>` in English, kebab-case (`loop.runner-offline`). */
export const ERROR_CODE_PATTERN = /^[a-z0-9-]+\.[a-z0-9-]+$/;
export const zErrorCode = z.string().regex(ERROR_CODE_PATTERN);

/**
 * The one error envelope of the API (ADR 0008): `message` is French and shown
 * as is by the page; `fields` maps an invalid field's dotted path to its message.
 */
export const zErrorEnvelope = z.strictObject({
  status: z.int(),
  code: zErrorCode,
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type ErrorEnvelope = z.infer<typeof zErrorEnvelope>;
