import { eventPayloadSchema, zRunner, zRunnerLatest } from '../index.js';

const RUNNER = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aff',
  machine: 'atelier',
  os: 'linux',
  arch: 'amd64',
  wsl: true,
  runnerVersion: '0.1.0',
  state: 'online',
  lastSeenAt: '2026-11-11T08:00:15.000Z',
  linkedAt: '2026-11-10T20:00:00.000Z',
};

describe('zRunner', () => {
  it('is the Runner of GET /api/runner, and the payload of runner.upserted', () => {
    expect(zRunner.parse(RUNNER)).toEqual(RUNNER);
    expect(eventPayloadSchema('runner.upserted')?.parse(RUNNER)).toEqual(RUNNER);
  });

  it('is online or offline, on a system the Runner is built for', () => {
    expect(zRunner.safeParse({ ...RUNNER, state: 'away' }).success).toBe(false);
    expect(zRunner.safeParse({ ...RUNNER, os: 'windows' }).success).toBe(false);
    expect(zRunner.safeParse({ ...RUNNER, lastSeenAt: null }).success).toBe(false);
  });
});

describe('zRunnerLatest', () => {
  it('is the version of the binaries the server serves, GET /runner/latest', () => {
    expect(zRunnerLatest.parse({ version: 'abc1234' })).toEqual({ version: 'abc1234' });
    expect(zRunnerLatest.safeParse({ version: '' }).success).toBe(false);
    expect(zRunnerLatest.safeParse({}).success).toBe(false);
  });
});
