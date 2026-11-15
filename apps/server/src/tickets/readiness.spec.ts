import { isReady, type ReadinessOf } from './readiness.js';

const ticket = (over: Partial<ReadinessOf> = {}): ReadinessOf => ({ state: 'open', readyMark: true, labels: ['ready-for-agent'], blockedBy: [], ...over });
const tickets = (entries: [number, 'open' | 'closed'][]) => new Map(entries.map(([number, state]) => [number, { state }]));

describe('isReady', () => {
  it('is ready when open, marked, without needs-human and unblocked', () => {
    expect(isReady(ticket(), tickets([]))).toBe(true);
  });

  it('is not ready closed, unmarked or with needs-human', () => {
    expect(isReady(ticket({ state: 'closed' }), tickets([]))).toBe(false);
    expect(isReady(ticket({ readyMark: false }), tickets([]))).toBe(false);
    expect(isReady(ticket({ labels: ['ready-for-agent', 'needs-human'] }), tickets([]))).toBe(false);
  });

  it('is ready only when every blocker is a closed Ticket', () => {
    expect(isReady(ticket({ blockedBy: [3, 4] }), tickets([[3, 'closed'], [4, 'closed']]))).toBe(true);
    expect(isReady(ticket({ blockedBy: [3, 4] }), tickets([[3, 'closed'], [4, 'open']]))).toBe(false);
  });

  it('counts an unknown blocker as open', () => {
    expect(isReady(ticket({ blockedBy: [9] }), tickets([]))).toBe(false);
  });
});
