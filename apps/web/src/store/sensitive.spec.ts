import { sensitiveBlockedReason } from './sensitive.js';

describe('sensitiveBlockedReason', () => {
  it.each(['connecting', 'resync'] as const)('is the French reason while %s', (connection) => {
    expect(sensitiveBlockedReason({ connection })).toBe('Indisponible pendant la resynchronisation');
  });

  it('is null once live', () => {
    expect(sensitiveBlockedReason({ connection: 'live' })).toBeNull();
  });
});
