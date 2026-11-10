import { loadEnv, parseEnv } from './env.js';

const DATABASE_URL = 'postgresql://crewdeck:crewdeck@localhost:5432/crewdeck';

describe('parseEnv', () => {
  it('applies the defaults', () => {
    expect(parseEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      CREWDECK_COMMIT: 'dev',
    });
  });

  it('reads the given values', () => {
    expect(parseEnv({ NODE_ENV: 'production', PORT: '8080', DATABASE_URL, CREWDECK_COMMIT: 'abc123' })).toEqual({
      NODE_ENV: 'production',
      PORT: 8080,
      DATABASE_URL,
      CREWDECK_COMMIT: 'abc123',
    });
  });

  it('lists every failed key', () => {
    expect(() => parseEnv({ NODE_ENV: 'staging', PORT: 'http' })).toThrow(
      expect.objectContaining({ keys: ['NODE_ENV', 'PORT', 'DATABASE_URL'] }),
    );
  });
});

describe('loadEnv', () => {
  it('exits the process with the failed keys listed', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    loadEnv({ PORT: '-1' });

    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.join('\n')).toMatch(/PORT[\s\S]*DATABASE_URL/);
  });
});
