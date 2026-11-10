/**
 * When `.github/workflows/provision.yml` runs: on a pull request or a push
 * that changes the provisioning, never otherwise. Its `paths` filters are
 * matched as GitHub matches them (a file changed by the event matches one
 * pattern; `**` crosses directories).
 */
import { readFileSync } from 'node:fs';
import { matchesGlob, resolve } from 'node:path';

const workflows = resolve(import.meta.dirname, '../../../.github/workflows');
const read = (name: string): string => readFileSync(resolve(workflows, name), 'utf8');

/** `on.<event>.paths` of a workflow, read line by line: the block lists under each event. */
const triggerPaths = (text: string): Record<string, string[]> => {
  const events: Record<string, string[]> = {};
  let inOn = false;
  let event = '';
  let inPaths = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) {
      inOn = line.startsWith('on:');
      continue;
    }
    if (!inOn) continue;
    const eventLine = /^ {2}([\w-]+):\s*$/.exec(line);
    if (eventLine?.[1]) {
      event = eventLine[1];
      events[event] = [];
      inPaths = false;
      continue;
    }
    if (/^ {4}paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) inPaths = false;
    const item = /^ {6}- (.+?)\s*$/.exec(line);
    if (inPaths && item?.[1]) events[event]?.push(item[1]);
  }
  return events;
};

const paths = triggerPaths(read('provision.yml'));

const runsOn = (event: string, changed: string[]): boolean =>
  changed.some((file) => (paths[event] ?? []).some((pattern) => matchesGlob(file, pattern)));

describe.each(['pull_request', 'push'])('provision.yml on a %s', (event) => {
  it('is filtered by paths', () => {
    expect(paths[event]?.length).toBeGreaterThan(0);
  });

  it('runs when infra/provision/provision.sh changes', () => {
    expect(runsOn(event, ['infra/provision/provision.sh'])).toBe(true);
    expect(runsOn(event, ['apps/web/src/main.ts', 'infra/provision/provision.sh'])).toBe(true);
  });

  it('runs when its specs or its test image change', () => {
    expect(runsOn(event, ['infra/provision/src/provision.ssh.spec.ts'])).toBe(true);
    expect(runsOn(event, ['infra/provision/test/Dockerfile'])).toBe(true);
  });

  it('does not run otherwise', () => {
    expect(runsOn(event, ['apps/server/src/main.ts', 'infra/deploy/docker-compose.yml', 'infra/edge/Caddyfile', 'docs/ci.md'])).toBe(false);
  });
});

describe('provision.yml', () => {
  it('runs the integration specs of provision', () => {
    expect(read('provision.yml')).toContain('run: pnpm exec nx test-integration provision');
  });

  it('is the only workflow running them: verify.yml’s integration job leaves provision out', () => {
    expect(read('verify.yml')).toContain('run: pnpm exec nx "$NX" -t test-integration --exclude provision');
  });
});
