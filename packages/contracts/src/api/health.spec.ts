import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zHealth } from '../index.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../../fixtures/api', name), 'utf8'));

describe('zHealth', () => {
  it('accepts the shared fixture', () => {
    expect(zHealth.parse(fixture('health.json'))).toEqual({
      status: 'ok',
      commit: '0123456789abcdef0123456789abcdef01234567',
      db: 'ok',
    });
  });

  it('rejects a status other than ok', () => {
    const result = zHealth.safeParse(fixture('health.invalid.json'));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['status']]);
  });

  it('rejects a db state outside ok and down', () => {
    expect(zHealth.safeParse({ status: 'ok', commit: 'dev', db: 'maybe' }).success).toBe(false);
  });
});
