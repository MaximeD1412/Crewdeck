import { zId } from '@crewdeck/contracts';
import { Body, type CanActivate, Controller, ForbiddenException, Get, type INestApplication, Module, Post, UseGuards } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { expectEnvelope, expectFields, startApp } from '../../test/route-baseline.js';
import { parseEnv } from '../config/env.js';
import { AppError, conflict, notFound, unprocessable } from './app-error.js';

class ProbeInputDto extends createZodDto(z.object({ name: z.string().min(1), items: z.array(z.object({ id: zId })) })) {}
class ProbeRecordDto extends createZodDto(z.record(z.string(), z.string().min(3).regex(/^[a-z]+$/))) {}
class ProbeOutputDto extends createZodDto(z.object({ ok: z.literal(true) })) {}

class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

@Controller('probe')
class ProbeController {
  @Post('record')
  record(@Body() input: ProbeRecordDto): { size: number } {
    return { size: Object.keys(input).length };
  }

  @Get('guarded')
  @UseGuards(DenyGuard)
  guarded(): { ok: true } {
    return { ok: true };
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException();
  }

  @Post('validate')
  @ZodResponse({ type: ProbeOutputDto })
  validate(@Body() input: ProbeInputDto): ProbeOutputDto {
    return { ok: input.name.length > 0 } as ProbeOutputDto;
  }

  @Get('rule')
  rule(): never {
    throw new AppError(422, 'test.rule', 'La règle du test est enfreinte.');
  }

  @Get('missing')
  missing(): never {
    throw notFound('test.missing', 'Introuvable.');
  }

  @Get('stale')
  stale(): never {
    throw conflict('test.stale', 'Déjà changé.');
  }

  @Get('fields')
  fields(): never {
    throw unprocessable('test.fields', 'Le nom est pris.', { name: 'Déjà pris.' });
  }

  @Get('boom')
  boom(): never {
    throw new Error('the internals of a fault');
  }

  @Get('bad-output')
  @ZodResponse({ type: ProbeOutputDto })
  badOutput(): ProbeOutputDto {
    return { ok: false } as unknown as ProbeOutputDto;
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const env = parseEnv({ DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck' });

describe('the error envelope', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { imports: [ProbeModule] }));
  });

  afterAll(() => app.close());

  const post = (path: string, body: string): Promise<Response> =>
    fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

  it('answers a valid input through its DTO', async () => {
    const res = await post('/api/probe/validate', JSON.stringify({ name: 'a', items: [] }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('renders an invalid input as 400 validation.invalid, fields naming each invalid path', async () => {
    const res = await post('/api/probe/validate', JSON.stringify({ name: '', items: [{ id: '019a6f3e-7c2a-7b1e-9f00-1234567890ab' }, { id: '42' }] }));

    const fields = await expectFields(res, ['name', 'items.1.id']);
    expect(await res.json()).toMatchObject({ message: 'Certaines valeurs ne sont pas valides.' });
    // In French, as every error message the page shows.
    expect(fields['items.1.id']).toBe('UUID invalide');
  });

  it('names a missing body as the root path', async () => {
    const res = await post('/api/probe/validate', JSON.stringify([]));

    await expectFields(res, ['']);
  });

  it('names the paths of keys Object.prototype has, the first message of a path kept', async () => {
    const res = await post('/api/probe/record', '{"constructor":42,"toString":42,"hasOwnProperty":42,"ok":"abc","short":"A"}');

    const fields = await expectFields(res, ['constructor', 'toString', 'hasOwnProperty', 'short']);
    // "A" breaks both the length and the pattern: the first issue's message is kept.
    expect(fields['short']).toMatch(/^Trop petit/);
  });

  it.each(['/api/probe/guarded', '/api/probe/forbidden'])('never answers 403: %s is a 404 http.not-found', async (path) => {
    await expectEnvelope(await fetch(`${url}${path}`), 404, 'http.not-found');
  });

  it('renders an AppError as is', async () => {
    const res = await fetch(`${url}/api/probe/rule`);

    await expectEnvelope(res, 422, 'test.rule');
    expect(await res.json()).toEqual({ status: 422, code: 'test.rule', message: 'La règle du test est enfreinte.' });
  });

  it('renders the helpers with their status', async () => {
    await expectEnvelope(await fetch(`${url}/api/probe/missing`), 404, 'test.missing');
    await expectEnvelope(await fetch(`${url}/api/probe/stale`), 409, 'test.stale');
    const res = await fetch(`${url}/api/probe/fields`);
    await expectEnvelope(res, 422, 'test.fields');
    expect(await res.json()).toEqual({ status: 422, code: 'test.fields', message: 'Le nom est pris.', fields: { name: 'Déjà pris.' } });
  });

  it('renders an unknown route as 404 http.not-found', async () => {
    const res = await fetch(`${url}/api/nothing-here`);

    await expectEnvelope(res, 404, 'http.not-found');
    expect(await res.json()).toEqual({ status: 404, code: 'http.not-found', message: 'Cette adresse n’existe pas.' });
  });

  it('renders an unexpected throw as 500 server.internal, without its stack', async () => {
    const res = await fetch(`${url}/api/probe/boom`);

    await expectEnvelope(res, 500, 'server.internal');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 500, code: 'server.internal', message: 'Une erreur inattendue est survenue.' });
    expect(text).not.toContain('internals');
    expect(text).not.toContain('error.filter.spec');
  });

  it('renders an output that breaks its schema as 500 server.internal', async () => {
    await expectEnvelope(await fetch(`${url}/api/probe/bad-output`), 500, 'server.internal');
  });

  it('renders a body that is not JSON as 400 http.bad-request', async () => {
    const res = await post('/api/probe/validate', '{"name":');

    await expectEnvelope(res, 400, 'http.bad-request');
    expect(await res.json()).toEqual({ status: 400, code: 'http.bad-request', message: 'La requête n’est pas valide.' });
  });

  it('renders a body too large with its status, as http.bad-request', async () => {
    const res = await post('/api/probe/validate', JSON.stringify({ name: 'x'.repeat(200_000), items: [] }));

    await expectEnvelope(res, 413, 'http.bad-request');
  });
});
