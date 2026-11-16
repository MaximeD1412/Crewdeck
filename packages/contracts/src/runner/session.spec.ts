import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zHello, zRunnerToServer, zServerToRunner, zSessionStart, zSessionStateMessage } from '../index.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/runner');
const fixture = <T = Record<string, unknown>>(type: string): T => JSON.parse(readFileSync(join(FIXTURES, `${type}.json`), 'utf8')) as T;

describe('the Sessions of the Runner protocol', () => {
  it('sends session.start, session.stop and session.resume to the Runner, and session.state to the server', () => {
    for (const type of ['session.start', 'session.stop', 'session.resume']) {
      expect(zServerToRunner.parse(fixture(type))).toEqual(fixture(type));
      expect(zRunnerToServer.safeParse(fixture(type)).success).toBe(false);
    }
    expect(zRunnerToServer.parse(fixture('session.state'))).toEqual(fixture('session.state'));
    expect(zServerToRunner.safeParse(fixture('session.state')).success).toBe(false);
  });

  it('starts a Session with no first message, or the one of a StepRun of an agent Étape', () => {
    const start = fixture('session.start');
    const withoutStep = { ...start };
    delete withoutStep.step;
    expect(zSessionStart.parse(withoutStep).step).toBeUndefined();
    expect(zSessionStart.safeParse({ ...start, step: { stepRunId: start.sessionId, stepKind: 'deploy' } }).success).toBe(false);
  });

  it('takes a default Rôle or one the Pilote added', () => {
    const start = fixture('session.start');
    expect(zSessionStart.safeParse({ ...start, role: 'r-a1b2c3d4' }).success).toBe(true);
    expect(zSessionStart.safeParse({ ...start, role: 'dev' }).success).toBe(false);
  });

  it.each([
    ['..', false],
    ['feat/../main', false],
    ['-x', false],
    ['/feat', false],
    ['feat/', false],
    ['feat//x', false],
    ['feat/.x', false],
    ['feat.lock', false],
    ['feat__x', false],
    ['feat x', false],
    ['feat/12-sessions', true],
    ['develop', true],
  ])('takes the branch %s: %s', (branch, valid) => {
    expect(zSessionStart.safeParse({ ...fixture('session.start'), branch }).success).toBe(valid);
  });

  it('refuses an origin other than a GitHub repository, or a repository named . or ..', () => {
    const start = fixture('session.start');
    expect(zSessionStart.safeParse({ ...start, origin: { kind: 'gitlab', owner: 'acme', name: 'shop' } }).success).toBe(false);
    expect(zSessionStart.safeParse({ ...start, origin: { kind: 'github', owner: 'acme', name: '..' } }).success).toBe(false);
    expect(zSessionStart.safeParse({ ...start, origin: { kind: 'github', owner: '-acme', name: 'shop' } }).success).toBe(false);
    expect(zSessionStart.safeParse({ ...start, permissionMode: 'plan' }).success).toBe(false);
  });

  it('reports a state of the six, an error by its code only', () => {
    const state = fixture('session.state');
    expect(zSessionStateMessage.parse({ ...state, state: 'ended', outcome: 'error', error: 'branch-busy' })).toMatchObject({ error: 'branch-busy' });
    expect(zSessionStateMessage.safeParse({ ...state, state: 'paused' }).success).toBe(false);
    expect(zSessionStateMessage.safeParse({ ...state, state: 'ended', outcome: 'error', error: 'git: fatal: not a repository' }).success).toBe(false);
  });

  it('says in the hello the Sessions the Runner knows, the hello of a Runner without any still valid', () => {
    const hello = fixture('hello');
    const sessionId = fixture('session.state').sessionId;
    expect(zHello.parse({ ...hello, sessions: [{ sessionId, alive: false }] }).sessions).toEqual([{ sessionId, alive: false }]);
    expect(zHello.parse(hello).sessions).toBeUndefined();
    expect(zHello.safeParse({ ...hello, sessions: [{ sessionId: 'x', alive: true }] }).success).toBe(false);
  });
});
