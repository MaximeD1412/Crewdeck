/**
 * The script run twice in a row on a fresh Ubuntu 24.04 (src/global-setup.ts):
 * the first run applies every step, the second changes nothing and says so.
 */
import { inject } from 'vitest';
import { lastLine, stepLines } from './machine.js';

const runs = inject('runs');

describe('provision.sh, twice in a row on a fresh Ubuntu 24.04', () => {
  it('applies every step on the first run', () => {
    expect(runs.first.status).toBe(0);
    const steps = stepLines(runs.first.stdout);
    expect(steps.map((line) => line.slice(0, 5))).toEqual(['[1/7]', '[2/7]', '[3/7]', '[4/7]', '[5/7]', '[6/7]', '[7/7]']);
    for (const line of steps) expect(line).toMatch(/^\[\d\/7\] .+ : appliqué : .+$/);
    expect(lastLine(runs.first.stdout)).toMatch(/^7 étape\(s\) sur 7 appliquée\(s\) : ouvrir une session ssh ops@/);
  });

  it('says « déjà fait » for every step on the second run, and « rien à changer » last', () => {
    expect(runs.second.status).toBe(0);
    const steps = stepLines(runs.second.stdout);
    expect(steps).toHaveLength(7);
    for (const line of steps) expect(line).toMatch(/^\[\d\/7\] .+ : déjà fait$/);
    expect(lastLine(runs.second.stdout)).toBe('rien à changer');
  });

  it('changes no file under /etc on the second run', () => {
    const etc = inject('etc');
    expect(etc.second).toBe(etc.first);
  });

  it('restarts no service on the second run', () => {
    const services = inject('services');
    expect(services.second).toBe(services.first);
  });

  it('writes only the summary on stdout', () => {
    expect(runs.first.stdout.split('\n').filter(Boolean)).toHaveLength(8);
  });
});
