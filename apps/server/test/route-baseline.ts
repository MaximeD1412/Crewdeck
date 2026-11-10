import { type ErrorEnvelope, zErrorEnvelope } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { type AppOptions, createApp } from '../src/app.js';
import type { Env } from '../src/config/env.js';

/**
 * What every route test reuses (ADR 0008, « Test baseline »): boot the app on a
 * free port, then check an error is the envelope with its status and code.
 */

/** Boots the app on 127.0.0.1 and a free port, logs off unless `options.logs` says otherwise. */
export const startApp = async (env: Env, options: AppOptions = {}): Promise<{ app: INestApplication; url: string }> => {
  const app = await createApp(env, { logs: false, ...options });
  await app.listen(0, '127.0.0.1');
  return { app, url: await app.getUrl() };
};

/** Asserts `res` is the error envelope with `status` and `code`, and returns it. Reads a clone: the body stays readable. */
export const expectEnvelope = async (res: Response, status: number, code: string): Promise<ErrorEnvelope> => {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  const envelope = zErrorEnvelope.parse(await res.clone().json());
  expect(envelope).toMatchObject({ status, code });
  return envelope;
};

/** Asserts `res` is a 400 `validation.invalid` whose `fields` name exactly `paths` (dotted, `items.0.id`). */
export const expectFields = async (res: Response, paths: string[]): Promise<Record<string, string>> => {
  const { fields = {} } = await expectEnvelope(res, 400, 'validation.invalid');
  expect(Object.keys(fields).sort()).toEqual([...paths].sort());
  for (const message of Object.values(fields)) expect(message).not.toBe('');
  return fields;
};
