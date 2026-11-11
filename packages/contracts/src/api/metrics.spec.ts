import { LATENCY_BATCH_MAX, zLatencyBatch } from '../index.js';

const SAMPLE = { seq: 12, source: 'github', delayMs: 300, at: '2026-11-11T08:00:00.300Z' };

describe('zLatencyBatch', () => {
  it('is 1 to 100 samples, each the seq, the source, the delay and when it was measured', () => {
    expect(zLatencyBatch.parse({ samples: [SAMPLE] })).toEqual({ samples: [SAMPLE] });
    expect(zLatencyBatch.parse({ samples: Array.from({ length: LATENCY_BATCH_MAX }, () => SAMPLE) }).samples).toHaveLength(100);
    expect(zLatencyBatch.safeParse({ samples: [] }).success).toBe(false);
    expect(zLatencyBatch.safeParse({ samples: Array.from({ length: LATENCY_BATCH_MAX + 1 }, () => SAMPLE) }).success).toBe(false);
  });

  it('reads the seq the page sends as a decimal string', () => {
    expect(zLatencyBatch.parse({ samples: [{ ...SAMPLE, seq: '12' }] }).samples[0]?.seq).toBe(12);
  });

  it('accepts a delay over 10 min, which the server drops, but no negative or fractional delay', () => {
    expect(zLatencyBatch.safeParse({ samples: [{ ...SAMPLE, delayMs: 20 * 60_000 }] }).success).toBe(true);
    expect(zLatencyBatch.safeParse({ samples: [{ ...SAMPLE, delayMs: -1 }] }).success).toBe(false);
    expect(zLatencyBatch.safeParse({ samples: [{ ...SAMPLE, delayMs: 1.5 }] }).success).toBe(false);
  });

  it('knows the four sources of an event', () => {
    for (const source of ['github', 'runner', 'pilot', 'scheduler']) expect(zLatencyBatch.safeParse({ samples: [{ ...SAMPLE, source }] }).success).toBe(true);
    expect(zLatencyBatch.safeParse({ samples: [{ ...SAMPLE, source: 'webhook' }] }).success).toBe(false);
    expect(zLatencyBatch.safeParse({ samples: [{ ...SAMPLE, at: 'hier' }] }).success).toBe(false);
  });
});
