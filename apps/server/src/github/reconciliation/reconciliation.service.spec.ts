import type { INestApplication } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import { parseEnv } from '../../config/env.js';
import { loggerParams } from '../../logging/logger.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { GitHubInstallations, type LinkedInstallation } from '../webhooks/installations.js';
import { RECONCILE_EVERY_MS, RECONCILE_FIRST_AFTER_MS, ReconcileHooks, Reconciliation } from './reconciliation.service.js';

const PILOT_A = '01900000-0000-7000-8000-00000000000a';
const PILOT_B = '01900000-0000-7000-8000-00000000000b';

describe('the reconciliation of the followed repositories', () => {
  let app: INestApplication;
  let hooks: ReconcileHooks;
  let linked: LinkedInstallation[];
  let calls: { key: string; pilotId: string; installationId: number; scope: string }[];
  const lines: string[] = [];

  beforeEach(async () => {
    // Before the app starts: @nestjs/schedule arms its timers at `init`.
    vi.useFakeTimers();
    linked = [
      { installationId: 51000001, pilotId: PILOT_A },
      { installationId: 51000002, pilotId: PILOT_B },
    ];
    calls = [];
    lines.length = 0;
    const moduleRef = await Test.createTestingModule({
      imports: [
        ScheduleModule.forRoot(),
        LoggerModule.forRoot(loggerParams(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://x@127.0.0.1:1/x' }), { write: (line: string) => lines.push(line) })),
      ],
      providers: [ReconcileHooks, Reconciliation, { provide: GitHubInstallations, useValue: { linked: () => Promise.resolve(linked) } }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    hooks = app.get(ReconcileHooks);
    const record = (key: string) => ({
      key,
      reconcile: ({ pilotId, installationId }: { pilotId: string; installationId: number }) => {
        calls.push({ key, pilotId, installationId, scope: currentPilotId() });
      },
    });
    hooks.register(record('repositories'));
    hooks.register(record('issues'));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  /** Moves the clock by `ms`, running what it triggers, promises included. */
  const elapse = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it('runs once 10 s after boot, then every 15 min', async () => {
    expect(RECONCILE_FIRST_AFTER_MS).toBe(10_000);
    expect(RECONCILE_EVERY_MS).toBe(15 * 60_000);

    await elapse(9_999);
    expect(calls).toEqual([]);
    await elapse(1);
    expect(calls).toHaveLength(4);

    await elapse(15 * 60_000 - 10_000 - 1);
    expect(calls).toHaveLength(4);
    await elapse(1);
    expect(calls).toHaveLength(8);
    await elapse(15 * 60_000);
    expect(calls).toHaveLength(12);
  });

  it('calls every hook for each linked installation, in the scope of its Pilote', async () => {
    await elapse(10_000);

    expect(calls).toEqual([
      { key: 'repositories', pilotId: PILOT_A, installationId: 51000001, scope: PILOT_A },
      { key: 'issues', pilotId: PILOT_A, installationId: 51000001, scope: PILOT_A },
      { key: 'repositories', pilotId: PILOT_B, installationId: 51000002, scope: PILOT_B },
      { key: 'issues', pilotId: PILOT_B, installationId: 51000002, scope: PILOT_B },
    ]);
  });

  it('goes on when a hook throws, and logs it with its key and installation', async () => {
    hooks.register({
      key: 'broken',
      reconcile: () => {
        throw new Error('GitHub is down');
      },
    });

    await elapse(10_000);

    expect(calls).toHaveLength(4);
    const failures = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line['msg'] === 'reconcile hook failed');
    expect(failures).toEqual([
      expect.objectContaining({ key: 'broken', installationId: 51000001, pilotId: PILOT_A, err: expect.objectContaining({ message: 'GitHub is down' }) }),
      expect.objectContaining({ key: 'broken', installationId: 51000002, pilotId: PILOT_B }),
    ]);
  });

  it('goes on when the installations cannot be read, and runs at the next tick', async () => {
    vi.spyOn(app.get(GitHubInstallations), 'linked').mockRejectedValueOnce(new Error('database down'));

    await elapse(10_000);
    expect(calls).toEqual([]);
    expect(lines.some((line) => line.includes('reconciliation failed'))).toBe(true);

    await elapse(15 * 60_000);
    expect(calls).toHaveLength(4);
  });

  it('never overlaps: a tick while a run is still going is skipped', async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    let started = 0;
    hooks.register({
      key: 'slow',
      reconcile: async () => {
        started += 1;
        if (started === 1) await slow;
      },
    });

    await elapse(10_000);
    expect(started).toBe(1);
    await elapse(15 * 60_000);
    expect(started).toBe(1);

    release();
    await elapse(0);
    expect(started).toBe(2);
    await elapse(15 * 60_000);
    expect(started).toBe(4);
  });
});
