import { AppError } from '../errors/app-error.js';
import { assertFresh } from './freshness.js';

describe('assertFresh', () => {
  it('throws 409 realtime.stale for a command older than the resource’s last change', () => {
    const stale = (): void => assertFresh(5n, 4n);

    expect(stale).toThrow(AppError);
    try {
      stale();
    } catch (error) {
      expect((error as AppError).toEnvelope()).toEqual({
        status: 409,
        code: 'realtime.stale',
        message: 'L’état a changé depuis ton dernier affichage : vérifie avant de recommencer.',
      });
    }
  });

  it('passes for a command carrying the resource’s last seq, or a later one', () => {
    expect(() => assertFresh(5n, 5n)).not.toThrow();
    expect(() => assertFresh(5n, 6n)).not.toThrow();
  });
});
