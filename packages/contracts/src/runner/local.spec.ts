import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_ITEM_KINDS, localSealedOfParam, localSealedParam, localTextAad, zLocalChanged, zRunnerToServer, zServerToRunner } from '../index.js';

const FIXTURE = join(import.meta.dirname, '../../fixtures/runner/local.changed.json');
const fixture = (): Record<string, unknown> & { items: Record<string, unknown>[]; unreadable: Record<string, unknown>[] } =>
  JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown> & { items: Record<string, unknown>[]; unreadable: Record<string, unknown>[] };

const ticket = () => {
  const message = fixture();
  const item = message.items.find((candidate) => candidate['kind'] === 'ticket');
  if (!item) throw new Error('the fixture has no ticket');
  return { message, item };
};
const withTicket = (fields: Record<string, unknown>) => {
  const { message, item } = ticket();
  return { ...message, items: [{ ...item, ...fields }] };
};

describe('local.changed', () => {
  it('is a message of the Runner, never of the server, its fixture holding every kind of item', () => {
    const message = fixture();
    expect(zRunnerToServer.parse(message)).toMatchObject({ type: 'local.changed', full: false });
    expect(zServerToRunner.safeParse(message).success).toBe(false);
    expect(new Set(message.items.map((item) => item['kind']))).toEqual(new Set(LOCAL_ITEM_KINDS));
    expect(zLocalChanged.parse(message).unreadable).toEqual([expect.objectContaining({ key: 'AAECAwQFBgcICQoLDA0ODw', reason: 'front-matter' })]);
  });

  it('holds only the product’s labels in clear, the others sealed', () => {
    expect(zLocalChanged.safeParse(withTicket({ labels: ['priority:P0', 'size:XL', 'ready-for-agent', 'needs-human'] })).success).toBe(true);
    expect(zLocalChanged.safeParse(withTicket({ labels: ['type:fix'] })).success).toBe(false);
    expect(zLocalChanged.safeParse(withTicket({ labels: ['revue-visuelle'] })).success).toBe(false);
  });

  it('never carries a title, a body or a path in clear', () => {
    expect(zLocalChanged.safeParse(withTicket({ title: 'Panier partagé' })).success).toBe(false);
    expect(zLocalChanged.safeParse(withTicket({ body: 'Le texte' })).success).toBe(false);
    expect(zLocalChanged.safeParse(withTicket({ titleSealed: null })).success).toBe(false);
    const message = fixture();
    expect(zLocalChanged.safeParse({ ...message, unreadable: [{ ...message.unreadable[0], path: 'tickets/7-courses.md' }] }).success).toBe(false);
    const change = message.items.find((item) => item['kind'] === 'change');
    expect(zLocalChanged.safeParse({ ...message, items: [{ ...change, headRef: 'fix/12-panier-partage' }] }).success).toBe(false);
  });

  it('keys an unreadable file by 16 bytes, and a content hash by its vault key version', () => {
    const message = fixture();
    expect(zLocalChanged.safeParse({ ...message, unreadable: [{ ...message.unreadable[0], key: 'AAECAwQFBgcICQoLDA0ODxA' }] }).success).toBe(false);
    expect(zLocalChanged.safeParse(withTicket({ contentHash: 'abc' })).success).toBe(false);
  });

  it('names the place of each sealed text in its additional data', () => {
    expect(localTextAad('019a6f00-0000-7000-8000-0000000000b1', 'ticket:12:title')).toBe('local:019a6f00-0000-7000-8000-0000000000b1:ticket:12:title');
  });

  it('carries a sealed text as one flat param of a Décision, and back', () => {
    const sealed = zLocalChanged.parse(fixture()).unreadable[0]?.pathSealed;
    if (!sealed) throw new Error('the fixture has no unreadable file');
    expect(localSealedParam(sealed)).toBe(`${sealed.key}.${sealed.ciphertext}`);
    expect(localSealedOfParam(localSealedParam(sealed))).toEqual(sealed);
    for (const broken of ['', 'abc', 'a.b.c', 'a+b.c', null, 3]) expect(localSealedOfParam(broken)).toBeNull();
  });
});
