import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMMAND_HEALTH_SECONDS,
  commandOutputAad,
  commandWrapAad,
  zClientMessage,
  zCommandOutputChunk,
  zCommandRun,
  zCommandVerdict,
  zRunnerToServer,
  zSealedCommands,
  zServerMessage,
  zServerToRunner,
  zSessionStart,
} from '../index.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/runner/command');
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

describe('the Commandes of the Runner', () => {
  it('has a fixture for each of its messages, both sockets', () => {
    expect(readdirSync(FIXTURES).sort()).toEqual(
      [
        'command.keys',
        'command.output',
        'command.replay',
        'command.run',
        'command.started',
        'command.stop',
        'command.verdict',
        'tab.command.close',
        'tab.command.error',
        'tab.command.keys',
        'tab.command.open',
        'tab.command.output',
      ].map((name) => `${name}.json`),
    );
  });

  it.each(['command.run', 'command.stop', 'command.replay'])('accepts %s, server to Runner', (name) => {
    expect(zServerToRunner.parse(fixture(name))).toEqual(fixture(name));
  });

  it.each(['command.started', 'command.verdict', 'command.keys', 'command.output'])('accepts %s, Runner to server', (name) => {
    expect(zRunnerToServer.parse(fixture(name))).toEqual(fixture(name));
  });

  it.each(['command.open', 'command.close'])('accepts %s, tab to server', (name) => {
    expect(zClientMessage.parse(fixture(`tab.${name}`))).toEqual(fixture(`tab.${name}`));
  });

  it.each(['command.keys', 'command.output', 'command.error'])('accepts %s, server to tab', (name) => {
    expect(zServerMessage.parse(fixture(`tab.${name}`))).toEqual(fixture(`tab.${name}`));
  });

  it('gives command.run the same origin as session.start', () => {
    expect(zCommandRun.shape.origin).toBe(zSessionStart.shape.origin);
  });

  it('takes a run outside a Ticket (no ticket, branch nor SHA), and refuses a SHA that is not a full one', () => {
    const run = fixture('command.run');
    const ref = { stepId: 'deploy', ticket: null, branch: null, sha: null };
    expect(zCommandRun.parse({ ...run, ref })).toMatchObject({ ref });
    expect(zCommandRun.safeParse({ ...run, ref: { ...ref, sha: 'abc123' } }).success).toBe(false);
    expect(zCommandRun.safeParse({ ...run, ref: { ...ref, branch: '../etc' } }).success).toBe(false);
    expect(zCommandRun.safeParse({ ...run, commandId: 'Tests' }).success).toBe(false);
  });

  it('carries the text and the place only sealed, never in the clear', () => {
    const run = fixture('command.run');
    const parsed = zCommandRun.parse({ ...run, run: 'rm -rf ~', where: 'project' });
    expect(parsed).not.toHaveProperty('run');
    expect(parsed).not.toHaveProperty('where');
  });

  it('reads a verdict as figures: an exit code only when the process exited, and one of the reasons', () => {
    const verdict = fixture('command.verdict');
    expect(zCommandVerdict.parse({ ...verdict, reason: 'timeout', exitCode: null })).toMatchObject({ exitCode: null });
    expect(zCommandVerdict.safeParse({ ...verdict, reason: 'crashed' }).success).toBe(false);
    expect(zCommandVerdict.safeParse({ ...verdict, durationMs: -1 }).success).toBe(false);
    expect(zCommandVerdict.safeParse({ ...verdict, output: 'FAIL src/cart.spec.ts' }).success).toBe(true);
    expect(zCommandVerdict.parse({ ...verdict, output: 'FAIL src/cart.spec.ts' })).not.toHaveProperty('output');
  });

  it('reads the verdict of a health address: healthy passes with or without an exit code, health-timeout fails with none', () => {
    const verdict = fixture('command.verdict');
    const service = { ...verdict, passed: true, exitCode: null, reason: 'healthy' };
    expect(zCommandVerdict.parse(service)).toEqual(service);
    expect(zCommandVerdict.parse({ ...service, exitCode: 0 })).toMatchObject({ reason: 'healthy', exitCode: 0 });
    expect(zCommandVerdict.parse({ ...verdict, passed: false, exitCode: null, reason: 'health-timeout' })).toMatchObject({ reason: 'health-timeout' });
    expect(COMMAND_HEALTH_SECONDS).toBe(120);
  });

  it('opens the sealed part as the Commandes of a version: a text of 1 to 4000 characters, its place, its health address', () => {
    const sealed = { commands: { 'cmd-tests': { run: 'pnpm test', where: 'worktree' }, deploy: { run: 'pnpm dev', where: 'project', healthUrl: 'http://localhost:5173' } } };
    expect(zSealedCommands.parse(sealed)).toEqual(sealed);
    expect(zSealedCommands.safeParse({ commands: { 'cmd-tests': { run: '', where: 'worktree' } } }).success).toBe(false);
    expect(zSealedCommands.safeParse({ commands: { 'cmd-tests': { run: 'ls', where: 'home' } } }).success).toBe(false);
  });

  it('reads a chunk of output as one stream’s text at an instant, under the additional data of its run and seq', () => {
    const chunk = { stream: 'stderr', text: 'FAIL src/cart.spec.ts\n', at: '2026-11-17T09:01:00.200Z' };
    expect(zCommandOutputChunk.parse(chunk)).toEqual(chunk);
    expect(zCommandOutputChunk.safeParse({ ...chunk, stream: 'stdin' }).success).toBe(false);
    expect(commandOutputAad('019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01', 4)).toBe('command:019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01:4');
    expect(commandWrapAad('019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01', 'AQEB')).toBe('command:019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01:AQEB');
  });

  it('tells a tab only not-found or runner-offline, and never sends it a tabId', () => {
    const error = fixture('tab.command.error');
    expect(zServerMessage.parse({ ...error, code: 'command.runner-offline' })).toMatchObject({ code: 'command.runner-offline' });
    expect(zServerMessage.safeParse({ ...error, code: 'session.not-found' }).success).toBe(false);
    expect(Object.keys(zServerMessage.parse({ ...fixture('tab.command.output'), tabId: fixture('command.output').tabId }))).not.toContain('tabId');
  });
});
