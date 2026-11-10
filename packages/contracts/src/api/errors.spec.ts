import { zErrorCode, zErrorEnvelope } from '../index.js';

describe('zErrorEnvelope', () => {
  it('accepts an envelope, with or without fields', () => {
    const envelope = { status: 422, code: 'loop.runner-offline', message: 'Le Runner est hors ligne.' };
    expect(zErrorEnvelope.parse(envelope)).toEqual(envelope);
    const invalid = { status: 400, code: 'validation.invalid', message: 'Certaines valeurs ne sont pas valides.', fields: { 'items.0.id': 'Invalide' } };
    expect(zErrorEnvelope.parse(invalid)).toEqual(invalid);
  });

  it('rejects a key it does not know', () => {
    expect(zErrorEnvelope.safeParse({ status: 500, code: 'server.internal', message: 'x', stack: 'Error: …' }).success).toBe(false);
  });
});

describe('zErrorCode', () => {
  it.each(['loop.runner-offline', 'http.not-found', 'test.rule', 'a1.b2'])('accepts %s', (code) => {
    expect(zErrorCode.safeParse(code).success).toBe(true);
  });

  it.each(['notfound', 'Loop.offline', 'loop.runner_offline', 'loop.a.b', '.x', 'x.', 'loop. x'])('rejects %s', (code) => {
    expect(zErrorCode.safeParse(code).success).toBe(false);
  });
});
