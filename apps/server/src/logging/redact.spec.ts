import { Body, Controller, type INestApplication, Module, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { startApp } from '../../test/route-baseline.js';
import { parseEnv } from '../config/env.js';
import { Public } from '../scope/public.decorator.js';
import { REDACT_CENSOR, REDACT_PATHS } from './redact.js';

const SECRETS = {
  authorization: 'Bearer secret-bearer-4a1f',
  // The sign-in's cookie: a session cookie would ask its session of the database this app has not.
  cookie: 'crewdeck_oauth=secret-session-9b2e',
  ciphertext: 'secret-ciphertext-c3d0',
  payload: 'secret-payload-7e55',
  wrappedKey: 'secret-wrapped-key-0aa1',
  token: 'secret-token-55f2',
  code: 'secret-oauth-code-81c4',
  state: 'secret-oauth-state-d9e3',
};

class SealedDto extends createZodDto(z.object({ ciphertext: z.string(), payload: z.string() })) {}

@Controller('probe')
@Public()
class ProbeController {
  constructor(@InjectPinoLogger('Probe') private readonly logger: PinoLogger) {}

  @Post('sealed')
  sealed(@Body() body: SealedDto): never {
    // What a careless module might log: the sealed values, top level and one level down.
    this.logger.info({ ciphertext: body.ciphertext, idea: { ciphertext: body.ciphertext, wrappedKey: SECRETS.wrappedKey } }, 'idea received');
    this.logger.info({ message: { type: 'session.output', payload: body.payload }, runner: { token: SECRETS.token } }, 'relayed');
    // A Runner protocol message of the relay (RUNNER-2, SESSION-1), as a handler might log it.
    this.logger.info({ direction: 'in', message: { type: 'relay', id: 'relay-id', payload: body.payload } }, 'runner message');
    throw new Error('a fault after reading the body');
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('the logs (SEC-7)', () => {
  let app: INestApplication;
  let url: string;
  const lines: string[] = [];
  const output = (): string => lines.join('');

  beforeAll(async () => {
    const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', NODE_ENV: 'production' });
    ({ app, url } = await startApp(env, { imports: [ProbeModule], logs: { write: (line: string) => lines.push(line) } }));
  });

  afterAll(() => app.close());

  it('never show a credential, a body, a ciphertext or a payload of a request', async () => {
    const res = await fetch(`${url}/api/probe/sealed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: SECRETS.authorization, cookie: SECRETS.cookie },
      body: JSON.stringify({ ciphertext: SECRETS.ciphertext, payload: SECRETS.payload }),
    });
    expect(res.status).toBe(500);
    await vi.waitFor(() => expect(output()).toContain('request errored'));

    for (const secret of [SECRETS.authorization, 'secret-bearer', 'secret-session', SECRETS.ciphertext, SECRETS.payload, SECRETS.wrappedKey, SECRETS.token]) {
      expect(output()).not.toContain(secret);
    }
    expect(output()).toContain(REDACT_CENSOR);
  });

  it('never show the payload of a relay message of the Runner protocol, only its type', async () => {
    await fetch(`${url}/api/probe/sealed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ciphertext: SECRETS.ciphertext, payload: SECRETS.payload }),
    });
    await vi.waitFor(() => expect(output()).toContain('runner message'));
    const relay = lines.map((line) => JSON.parse(line) as { msg: string; message?: unknown }).find((line) => line.msg === 'runner message');

    expect(relay?.message).toEqual({ type: 'relay', id: 'relay-id', payload: REDACT_CENSOR });
    expect(output()).not.toContain(SECRETS.payload);
  });

  it('logs an unexpected error with its stack', () => {
    const error = lines.map((line) => JSON.parse(line) as { msg: string; err?: { message: string; stack: string } }).find((line) => line.msg === 'unexpected error');

    expect(error?.err?.message).toBe('a fault after reading the body');
    expect(error?.err?.stack).toContain('redact.spec.ts');
  });

  it('never show the code and the state of the OAuth callback', async () => {
    await fetch(`${url}/api/auth/github/callback?code=${SECRETS.code}&state=${SECRETS.state}`);
    await vi.waitFor(() => expect(output()).toContain('/api/auth/github/callback'));

    expect(output()).not.toContain(SECRETS.code);
    expect(output()).not.toContain(SECRETS.state);
  });

  it('redacts what ADR 0003 lists', () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'req.body',
        '*.ciphertext',
        '*.wrappedKey',
        '*.payload',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        'req.query.code',
        'req.query.state',
      ]),
    );
  });
});
