import { withSeq } from '@crewdeck/contracts';
import { Body, Controller, type INestApplication, type MiddlewareConsumer, Module, type NestModule, Param, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { expectEnvelope, expectFields, startApp } from '../../test/route-baseline.js';
import { parseEnv } from '../config/env.js';
import type { PrincipalRequest } from '../scope/principal.js';
import { SensitiveAction } from './sensitive-action.decorator.js';
import { SensitiveActionsService } from './sensitive-actions.service.js';

class StartDto extends createZodDto(withSeq(z.object({ note: z.string().optional() }))) {}
class NoSeqDto extends createZodDto(z.object({ note: z.string().optional() })) {}

/** The resource's `lastSeq`, as its row would hold it. */
const LAST_SEQ = 5n;

@Controller('probe-loops')
class ProbeController {
  constructor(private readonly sensitive: SensitiveActionsService) {}

  @Post(':id/start')
  @SensitiveAction('loop.start')
  start(@Param('id') _id: string, @Body() body: StartDto): { ok: true } {
    // createZodDto types the codec's output loosely: zSeq gives a number.
    this.sensitive.assertFresh(LAST_SEQ, BigInt(body.seq as number));
    return { ok: true };
  }

  /** A handler that forgets its freshness check. */
  @Post(':id/forgetful')
  @SensitiveAction('merge')
  forgetful(@Body() body: StartDto): { ok: boolean } {
    return { ok: body.seq !== undefined };
  }
}

/** Stands for the auth layer: the principal from a test header. */
@Module({ controllers: [ProbeController] })
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: PrincipalRequest & { headers: Record<string, unknown> }, _res: unknown, next: () => void) => {
        const pilotId = req.headers['x-test-pilot'];
        if (typeof pilotId === 'string') req.principal = { kind: 'pilot', pilotId };
        next();
      })
      .forRoutes('*');
  }
}

const DATABASE_URL = 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck';
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL });

describe('an Action sensible’s route', () => {
  let app: INestApplication;
  let url: string;
  const lines: string[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { imports: [ProbeModule], logs: { write: (line: string) => lines.push(line) } }));
  });

  afterAll(() => app.close());

  const post = (path: string, body: unknown) =>
    fetch(`${url}/api/probe-loops/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-pilot': 'p1' },
      body: JSON.stringify(body),
    });

  it('answers 400 validation.invalid on seq when the body carries none', async () => {
    await expectFields(await post('l1/start', { note: 'x' }), ['seq']);
  });

  it('answers 409 sensitive-action.stale when the state changed while the Pilote confirmed', async () => {
    const envelope = await expectEnvelope(await post('l1/start', { seq: '4' }), 409, 'sensitive-action.stale');
    expect(envelope.message).toBe('L’état a changé pendant que tu confirmais : vérifie et confirme de nouveau.');
  });

  it('runs on a fresh seq, and logs the action, its Pilote and its resource at info, never the body', async () => {
    lines.length = 0;
    const res = await post('l1/start', { seq: '5', note: 'une note privée' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line['action'] === 'loop.start');
    expect(logged).toMatchObject({ level: 30, action: 'loop.start', pilotId: 'p1', resourceId: 'l1' });
    expect(lines.join('')).not.toContain('une note privée');
  });

  it('fails with 500 when its handler skipped assertFresh', async () => {
    await expectEnvelope(await post('l1/forgetful', { seq: '5' }), 500, 'server.internal');
  });
});

describe('an Action sensible in production', () => {
  it('lets a handler that skipped assertFresh answer: the check fails the tests, never a Pilote', async () => {
    const { app, url } = await startApp(parseEnv({ NODE_ENV: 'production', CREWDECK_ENV: 'test', DATABASE_URL }), {
      imports: [ProbeModule],
    });
    try {
      const res = await fetch(`${url}/api/probe-loops/l1/forgetful`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-pilot': 'p1' },
        body: JSON.stringify({ seq: '5' }),
      });
      expect(res.status).toBe(201);
    } finally {
      await app.close();
    }
  });
});

describe('the boot', () => {
  it('fails on an Action sensible whose body has no seq', async () => {
    @Controller('probe-no-seq')
    class NoSeqController {
      @Post()
      @SensitiveAction('merge')
      merge(@Body() body: NoSeqDto): NoSeqDto {
        return body;
      }
    }
    @Module({ controllers: [NoSeqController] })
    class NoSeqModule {}

    await expect(startApp(env, { imports: [NoSeqModule] })).rejects.toThrow(/NoSeqController\.merge.*seq/);
  });

  it('fails on an Action sensible without a body', async () => {
    @Controller('probe-no-body')
    class NoBodyController {
      @Post()
      @SensitiveAction('schedule.resume')
      resume(): { ok: true } {
        return { ok: true };
      }
    }
    @Module({ controllers: [NoBodyController] })
    class NoBodyModule {}

    await expect(startApp(env, { imports: [NoBodyModule] })).rejects.toThrow(/NoBodyController\.resume.*seq/);
  });

  it('refuses an id that is not an Action sensible', () => {
    expect(() => SensitiveAction('delete' as never)).toThrow(/delete/);
  });
});
