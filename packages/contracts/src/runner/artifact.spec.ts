import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactRefFits, zClientMessage, zRunnerToServer, zServerMessage, zServerToRunner, zArtifactTicket } from '../index.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/runner/artifact');
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

describe('reading an artefact through the relay', () => {
  it('has a fixture for each of its messages, both sockets', () => {
    expect(readdirSync(FIXTURES).sort()).toEqual(
      ['artifact.content', 'artifact.error', 'artifact.read', 'tab.artifact.content', 'tab.artifact.error', 'tab.artifact.read'].map((name) => `${name}.json`),
    );
  });

  it.each(['artifact.content', 'artifact.error'])('accepts %s, Runner to server', (name) => {
    expect(zRunnerToServer.parse(fixture(name))).toEqual(fixture(name));
  });

  it('accepts artifact.read, server to Runner', () => {
    expect(zServerToRunner.parse(fixture('artifact.read'))).toEqual(fixture('artifact.read'));
  });

  it('accepts artifact.read, tab to server', () => {
    expect(zClientMessage.parse(fixture('tab.artifact.read'))).toEqual(fixture('tab.artifact.read'));
  });

  it.each(['artifact.content', 'artifact.error'])('accepts %s, server to tab, never with the tabId', (name) => {
    expect(zServerMessage.parse(fixture(`tab.${name}`))).toEqual(fixture(`tab.${name}`));
    expect(Object.keys(zServerMessage.parse({ ...fixture(`tab.${name}`), tabId: fixture(name).tabId }))).not.toContain('tabId');
  });

  it.each([
    ['file', { path: 'docs/prd.md' }, true],
    ['file', { path: 'docs/prd.md', at: 'develop' }, true],
    ['file', { number: 3 }, false],
    ['ticket', { number: 12 }, true],
    ['ticket', { number: 12, path: 'x' }, false],
    ['change', { number: 4 }, true],
    ['diff', { number: 4 }, true],
    ['diff', { base: 'develop', head: 'feat/x' }, true],
    ['diff', { base: 'develop' }, false],
    ['command-output', { runId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01' }, true],
    ['command-output', {}, false],
  ] as const)('checks a %s ref %j: %s', (kind, ref, fits) => {
    expect(artifactRefFits(kind, ref)).toBe(fits);
    expect(zClientMessage.safeParse({ ...fixture('tab.artifact.read'), kind, ref }).success).toBe(fits);
  });

  it('refuses a git ref git would read as an option, and a path with a NUL', () => {
    const read = fixture('tab.artifact.read');
    expect(zClientMessage.safeParse({ ...read, kind: 'file', ref: { path: 'a.md', at: '--output=/tmp/x' } }).success).toBe(false);
    expect(zClientMessage.safeParse({ ...read, kind: 'diff', ref: { base: '-x', head: 'y' } }).success).toBe(false);
    expect(zClientMessage.safeParse({ ...read, kind: 'file', ref: { path: 'a\0b' } }).success).toBe(false);
  });

  it('leaves a path out of the repository to the Runner, which answers artifact.not-found', () => {
    expect(zClientMessage.safeParse({ ...fixture('tab.artifact.read'), kind: 'file', ref: { path: '../x' } }).success).toBe(true);
  });

  it('opens the content the Runner sealed for the encryption vector, a Ticket', () => {
    const vector = JSON.parse(readFileSync(join(import.meta.dirname, '../../fixtures/crypto/artifact.json'), 'utf8')) as { frame: unknown; plaintext: unknown };
    expect(zServerMessage.parse(vector.frame)).toEqual(vector.frame);
    expect(zArtifactTicket.parse(vector.plaintext)).toEqual(vector.plaintext);
  });
});
