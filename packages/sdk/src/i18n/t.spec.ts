import { createTranslator, t } from './t.js';

describe('t', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns the French copy of a key', () => {
    expect(t('router.notFound.title')).toBe("Cette page n'existe pas");
    expect(t('router.notFound.back')).toBe('Retour à « À toi »');
  });

  it('interpolates {name} parameters', () => {
    const translate = createTranslator({ 'test.greeting': '{name} a {count} Tickets, {name} !' });
    expect(translate('test.greeting', { name: 'Ada', count: 3 })).toBe('Ada a 3 Tickets, Ada !');
  });

  it('throws on an unknown key outside production', () => {
    expect(() => t('nope.missing' as never)).toThrow(/nope\.missing/);
  });

  it('returns an unknown key as is in production', () => {
    vi.stubEnv('PROD', true);
    expect(t('nope.missing' as never)).toBe('nope.missing');
  });
});
