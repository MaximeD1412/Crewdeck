import { Controller, Get, type INestApplication, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { expectEnvelope, startApp } from '../../test/route-baseline.js';
import { parseEnv } from '../config/env.js';
import type { PrincipalRequest } from './principal.js';
import { Public } from './public.decorator.js';
import { currentPilotId } from './scope.context.js';

/** Where the probe reads the scope: after an await, as a service would. */
const scopedPilotId = async (): Promise<{ pilotId: string }> => {
  await new Promise((resolve) => setTimeout(resolve, 1));
  return { pilotId: currentPilotId() };
};

@Controller('probe')
class ProbeController {
  @Get('private')
  private(): Promise<{ pilotId: string }> {
    return scopedPilotId();
  }

  @Get('open')
  @Public()
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('open-scoped')
  @Public()
  openScoped(): Promise<{ pilotId: string }> {
    return scopedPilotId();
  }
}

@Controller('probe-public')
@Public()
class PublicProbeController {
  @Get()
  get(): { ok: true } {
    return { ok: true };
  }
}

/** Stands for the auth layer (CORE-4's cookie, RUNNER-2's token): the principal from a test header. */
@Module({ controllers: [ProbeController, PublicProbeController] })
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: PrincipalRequest & { headers: Record<string, unknown> }, _res: unknown, next: () => void) => {
        const pilotId = req.headers['x-test-pilot'];
        if (typeof pilotId === 'string') req.principal = { kind: req.headers['x-test-kind'] === 'runner' ? 'runner' : 'pilot', pilotId };
        next();
      })
      .forRoutes('*');
  }
}

const env = parseEnv({ DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck' });

describe('ScopeGuard', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { imports: [ProbeModule] }));
  });

  afterAll(() => app.close());

  it('answers 401 auth.required with the envelope on a route without @Public() and without principal', async () => {
    const envelope = await expectEnvelope(await fetch(`${url}/api/probe/private`), 401, 'auth.required');

    expect(envelope).toEqual({ status: 401, code: 'auth.required', message: 'Connecte-toi pour continuer.' });
  });

  it.each(['pilot', 'runner'])('runs the handler in the scope of a %s principal’s Pilote', async (kind) => {
    const res = await fetch(`${url}/api/probe/private`, { headers: { 'x-test-pilot': 'p1', 'x-test-kind': kind } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pilotId: 'p1' });
  });

  it('keeps each concurrent request in its own scope', async () => {
    const pilots = ['p1', 'p2', 'p3', 'p4'];
    const bodies = await Promise.all(
      pilots.map(async (pilotId) => (await fetch(`${url}/api/probe/private`, { headers: { 'x-test-pilot': pilotId } })).json()),
    );

    expect(bodies).toEqual(pilots.map((pilotId) => ({ pilotId })));
  });

  it('lets a @Public() route, or a route of a @Public() controller, answer without principal', async () => {
    expect((await fetch(`${url}/api/probe/open`)).status).toBe(200);
    expect((await fetch(`${url}/api/probe-public`)).status).toBe(200);
  });

  it('opens no scope on a @Public() route: a scoped call there is a 500', async () => {
    await expectEnvelope(await fetch(`${url}/api/probe/open-scoped`), 500, 'server.internal');
  });

  it('keeps the app’s own public routes open', async () => {
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
  });
});
