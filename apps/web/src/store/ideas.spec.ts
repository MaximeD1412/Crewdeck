import { holdsIdea } from './ideas.js';

const NOW = new Date('2026-11-16T10:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('holdsIdea', () => {
  it('holds every Idée not merged nor rejected, however old', () => {
    for (const state of ['analysing', 'to-triage', 'analysed', 'retained'] as const) expect(holdsIdea({ state, updatedAt: daysAgo(400) }, NOW)).toBe(true);
  });

  it('holds one merged or rejected 90 days, as GET /api/state', () => {
    expect(holdsIdea({ state: 'merged', updatedAt: daysAgo(90) }, NOW)).toBe(true);
    expect(holdsIdea({ state: 'rejected', updatedAt: daysAgo(30) }, NOW)).toBe(true);
    expect(holdsIdea({ state: 'merged', updatedAt: daysAgo(91) }, NOW)).toBe(false);
  });
});
