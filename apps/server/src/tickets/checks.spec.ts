import { aggregateChecks, checkStateOf, statusAsCheck } from './checks.js';

describe('checkStateOf', () => {
  it.each([
    [{ status: 'queued', conclusion: null }, 'running'],
    [{ status: 'in_progress', conclusion: null }, 'running'],
    [{ status: 'waiting', conclusion: null }, 'running'],
    [{ status: 'completed', conclusion: 'success' }, 'passed'],
    [{ status: 'completed', conclusion: 'neutral' }, 'passed'],
    [{ status: 'completed', conclusion: 'skipped' }, 'passed'],
    [{ status: 'completed', conclusion: 'failure' }, 'failed'],
    [{ status: 'completed', conclusion: 'cancelled' }, 'failed'],
    [{ status: 'completed', conclusion: 'timed_out' }, 'failed'],
    [{ status: 'completed', conclusion: 'action_required' }, 'failed'],
  ] as const)('reads %j as %s', (run, state) => {
    expect(checkStateOf(run)).toBe(state);
  });

  it('reads a commit status the same way', () => {
    expect(checkStateOf(statusAsCheck('pending'))).toBe('running');
    expect(checkStateOf(statusAsCheck('success'))).toBe('passed');
    expect(checkStateOf(statusAsCheck('failure'))).toBe('failed');
    expect(checkStateOf(statusAsCheck('error'))).toBe('failed');
  });
});

describe('aggregateChecks', () => {
  it('is none without any check', () => {
    expect(aggregateChecks([])).toBe('none');
  });

  it('is pending while one runs, failed once one failed, else passed', () => {
    expect(aggregateChecks(['passed', 'running'])).toBe('pending');
    expect(aggregateChecks(['running', 'failed'])).toBe('pending');
    expect(aggregateChecks(['passed', 'failed'])).toBe('failed');
    expect(aggregateChecks(['passed', 'passed'])).toBe('passed');
  });
});
