import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_EVENT_KINDS, ENGINE_IDS, zEngineCapabilities, zEngineEvent } from '../index.js';

const FIXTURES = join(import.meta.dirname, '../../fixtures/runner');
const read = (path: string): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, path), 'utf8'));
const event = (kind: string) => read(`events/${kind}.json`);

describe('the normalised events of a Moteur', () => {
  it('are those of docs/spikes/engines.md, the spike having added none', () => {
    expect([...ENGINE_EVENT_KINDS].sort()).toEqual(
      ['auth-required', 'error', 'limit-reached', 'message', 'permission-request', 'question', 'result', 'tool-call', 'tool-result', 'usage'].sort(),
    );
  });

  it('have one fixture per kind, and no other', () => {
    const files = readdirSync(join(FIXTURES, 'events')).map((file) => file.replace(/\.json$/, ''));
    expect(files.sort()).toEqual([...ENGINE_EVENT_KINDS].sort());
  });

  it.each(ENGINE_EVENT_KINDS)('accept the fixture of %s', (kind) => {
    const fixture = event(kind);
    expect(fixture.kind).toBe(kind);
    expect(zEngineEvent.parse(fixture)).toEqual(fixture);
  });

  it('keep the provider’s raw event beside the normalised one, optional', () => {
    expect(event('tool-call').raw).toBeTypeOf('object');
    const withoutRaw = { ...event('tool-call') };
    delete withoutRaw.raw;
    expect(zEngineEvent.parse(withoutRaw)).toEqual(withoutRaw);
  });

  it('refuse an unknown kind, a seq that is not a positive integer, or an instant that is not one', () => {
    const message = event('message');
    expect(zEngineEvent.safeParse({ ...message, kind: 'thinking' }).success).toBe(false);
    expect(zEngineEvent.safeParse({ ...message, seq: 0 }).success).toBe(false);
    expect(zEngineEvent.safeParse({ ...message, seq: 1.5 }).success).toBe(false);
    expect(zEngineEvent.safeParse({ ...message, at: 'yesterday' }).success).toBe(false);
    expect(zEngineEvent.safeParse({ ...message, from: 'pilot' }).success).toBe(false);
  });

  it('end a turn ok, in error or interrupted, and nothing else', () => {
    expect(zEngineEvent.parse({ ...event('result'), status: 'interrupted' })).toMatchObject({ status: 'interrupted' });
    expect(zEngineEvent.safeParse({ ...event('result'), status: 'cancelled' }).success).toBe(false);
  });

  it('count usage windows of five hours or a week, in percent, and a limit on one of them or an unknown one', () => {
    const usage = event('usage') as { windows: { usedPercent: number }[] };
    expect(zEngineEvent.safeParse({ ...usage, windows: [{ ...usage.windows[0], id: 'day' }] }).success).toBe(false);
    expect(zEngineEvent.safeParse({ ...usage, windows: [{ ...usage.windows[0], usedPercent: 120 }] }).success).toBe(false);
    expect(zEngineEvent.safeParse({ ...usage, costUsdMicros: 0.5 }).success).toBe(false);
    expect(zEngineEvent.parse({ ...event('limit-reached'), window: 'unknown' })).toMatchObject({ window: 'unknown' });
    expect(zEngineEvent.safeParse({ ...event('limit-reached'), window: 'month' }).success).toBe(false);
  });
});

describe('the capabilities of a Moteur', () => {
  const capabilities = read('engines/claude-code.json');

  it('name one of the two Moteurs', () => {
    expect(ENGINE_IDS).toEqual(['claude-code', 'codex']);
    expect(zEngineCapabilities.parse(capabilities)).toEqual(capabilities);
    expect(zEngineCapabilities.safeParse({ ...capabilities, engine: 'gemini' }).success).toBe(false);
  });

  it('say why a model is not usable, for one of three reasons', () => {
    const models = capabilities.models as { reason?: string }[];
    expect(models.some((model) => model.reason === 'quota-reached')).toBe(true);
    expect(zEngineCapabilities.safeParse({ ...capabilities, models: [{ ...models[0], reason: 'expired' }] }).success).toBe(false);
  });

  it('report a Compte IA by subscription, API key or none, connected or to sign in', () => {
    expect(zEngineCapabilities.safeParse({ ...capabilities, account: { kind: 'oauth', state: 'connected' } }).success).toBe(false);
    expect(zEngineCapabilities.safeParse({ ...capabilities, account: { kind: 'none', state: 'expired' } }).success).toBe(false);
  });
});
