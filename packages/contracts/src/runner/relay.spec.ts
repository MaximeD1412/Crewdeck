import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zClientMessage, zRunnerToServer, zServerMessage, zServerToRunner, zSessionInputPayload, zSessionKeys } from '../index.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/runner/relay');
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

describe('the relay of a Session', () => {
  it('has a fixture for each of its messages, both sockets', () => {
    expect(readdirSync(FIXTURES).sort()).toEqual(
      [
        'relay',
        'session.input',
        'session.keys',
        'session.replay',
        'tab.relay',
        'tab.session.close',
        'tab.session.error',
        'tab.session.input',
        'tab.session.keys',
        'tab.session.open',
      ].map((name) => `${name}.json`),
    );
  });

  it.each(['session.keys', 'relay'])('accepts %s, Runner to server', (name) => {
    expect(zRunnerToServer.parse(fixture(name))).toEqual(fixture(name));
  });

  it.each(['session.replay', 'session.input'])('accepts %s, server to Runner', (name) => {
    expect(zServerToRunner.parse(fixture(name))).toEqual(fixture(name));
  });

  it.each(['session.open', 'session.close', 'session.input'])('accepts %s, tab to server', (name) => {
    expect(zClientMessage.parse(fixture(`tab.${name}`))).toEqual(fixture(`tab.${name}`));
  });

  it.each(['session.keys', 'relay', 'session.error'])('accepts %s, server to tab', (name) => {
    expect(zServerMessage.parse(fixture(`tab.${name}`))).toEqual(fixture(`tab.${name}`));
  });

  it('sends a live frame without tabId, and never the tabId to a tab', () => {
    const live = { ...fixture('relay') };
    delete live.tabId;
    expect(zRunnerToServer.parse(live)).toEqual(live);
    expect(Object.keys(zServerMessage.parse({ ...fixture('tab.relay'), tabId: fixture('relay').tabId }))).not.toContain('tabId');
  });

  it('refuses a replay or an input without its tabId, a fromSeq of 0, a nonce that is not 12 bytes', () => {
    const replay = fixture('session.replay');
    const withoutTab = { ...replay };
    delete withoutTab.tabId;
    expect(zServerToRunner.safeParse(withoutTab).success).toBe(false);
    expect(zServerToRunner.safeParse({ ...replay, fromSeq: 0 }).success).toBe(false);
    const input = fixture('tab.session.input');
    expect(zClientMessage.safeParse({ ...input, nonce: 'AAAA' }).success).toBe(false);
    expect(zClientMessage.safeParse({ ...input, inputId: 'not-an-id' }).success).toBe(false);
  });

  it('refuses keys without a wrap, or a wrap whose key is not 48 bytes', () => {
    const keys = fixture('session.keys') as { wraps: Record<string, unknown>[] };
    expect(zSessionKeys.safeParse({ ...keys, wraps: [] }).success).toBe(false);
    expect(zSessionKeys.safeParse({ ...keys, wraps: [{ ...keys.wraps[0], wrappedKey: keys.wraps[0].enc }] }).success).toBe(false);
  });

  it('tells a tab only not-found or runner-offline', () => {
    const error = fixture('tab.session.error');
    expect(zServerMessage.parse({ ...error, code: 'session.not-found' })).toMatchObject({ code: 'session.not-found' });
    expect(zServerMessage.safeParse({ ...error, code: 'session.ended' }).success).toBe(false);
  });

  it('reads an input as a message of text, nothing else yet', () => {
    expect(zSessionInputPayload.parse({ kind: 'message', text: 'Continue' })).toEqual({ kind: 'message', text: 'Continue' });
    expect(zSessionInputPayload.safeParse({ kind: 'message', text: '' }).success).toBe(false);
    expect(zSessionInputPayload.safeParse({ kind: 'answer', requestId: 'r1', text: 'oui' }).success).toBe(false);
  });
});
