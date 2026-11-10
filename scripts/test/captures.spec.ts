/**
 * `scripts/captures.sh` run for real, in a temporary git repository whose
 * `origin` is a local bare repository, with a `PATH` whose `pnpm` is a stub:
 * it records its call and writes, for each scenario of `CAPTURES_SCENARIOS`,
 * the two PNG headers (390 and 1280 px wide) `captures.spec.ts` would write.
 * No browser, no GitHub.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '../captures.sh');

/**
 * The stub of `pnpm`: one line per call (its arguments, `CAPTURES_SCENARIOS`,
 * `CAPTURES_DIR`), then a PNG signature and IHDR per capture, its content
 * changing with `STUB_RUN`. `STUB_WIDTH` replaces every width, `STUB_MISSING`
 * names a capture it does not write, `STUB_FAIL` makes it fail.
 */
const PNPM = `#!/usr/bin/env bash
printf '%s\\t%s\\t%s\\n' "$*" "\${CAPTURES_SCENARIOS-}" "\${CAPTURES_DIR-}" >> "$STUB_LOG"
[[ -z \${STUB_FAIL-} ]] || exit 1
IFS=, read -ra names <<< "$CAPTURES_SCENARIOS"
for name in "\${names[@]}"; do
  for width in 390 1280; do
    [[ "$name-$width" != "\${STUB_MISSING-}" ]] || continue
    w=\${STUB_WIDTH:-$width}
    {
      printf '\\x89PNG\\r\\n\\x1a\\n\\x00\\x00\\x00\\x0dIHDR'
      printf "\\\\x$(printf %02x $((w >> 24 & 255)))\\\\x$(printf %02x $((w >> 16 & 255)))\\\\x$(printf %02x $((w >> 8 & 255)))\\\\x$(printf %02x $((w & 255)))"
      printf '\\x00\\x00\\x03\\x20'
      printf 'run %s %s' "\${STUB_RUN:-1}" "$name"
    } > "$CAPTURES_DIR/$name-$width.png"
  done
done
`;

const IDENTITY = ['-c', 'user.name=essai', '-c', 'user.email=essai@example.invalid'];
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim();

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

/** The width a PNG's IHDR gives, big-endian at byte 16. */
const width = (png: Buffer): number => png.readUInt32BE(16);

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

let temporary: string;
let checkout: string;
let origin: string;
let log: string;
let stubs: string;

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'captures-sh-'));
  origin = join(temporary, 'origin.git');
  checkout = join(temporary, 'Crewdeck');
  log = join(temporary, 'pnpm.log');
  stubs = join(temporary, 'stubs');
  write(join(stubs, 'pnpm'), PNPM);
  chmodSync(join(stubs, 'pnpm'), 0o755);

  git(temporary, 'init', '-q', '--bare', '-b', 'develop', origin);
  write(join(checkout, '.process.json'), `${JSON.stringify({ projectName: 'Crewdeck', repo: 'Proprio/Essai' }, null, 2)}\n`);
  write(join(checkout, 'README.md'), 'code\n');
  git(temporary, 'init', '-q', '-b', 'develop', checkout);
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-qm', 'initial');
  git(checkout, 'remote', 'add', 'origin', origin);
  git(checkout, 'push', '-q', 'origin', 'develop');
  git(checkout, 'switch', '-qc', 'chore/12-x');
});

afterEach(() => {
  rmSync(temporary, { recursive: true, force: true });
});

const run = (args: string[], env: Record<string, string> = {}): Run => {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    cwd: checkout,
    encoding: 'utf8',
    env: {
      PATH: `${stubs}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: temporary,
      ...GIT_ENV,
      GIT_AUTHOR_NAME: 'essai',
      GIT_AUTHOR_EMAIL: 'essai@example.invalid',
      GIT_COMMITTER_NAME: 'essai',
      GIT_COMMITTER_EMAIL: 'essai@example.invalid',
      STUB_LOG: log,
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const pnpmCalls = (): string[][] => (existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n').map((line) => line.split('\t')) : []);

/** The files of `captures/<n>` on the origin, with their content. */
const branchFiles = (branch: string): Record<string, Buffer> => {
  const names = git(origin, 'ls-tree', '--name-only', branch).split('\n').filter(Boolean);
  return Object.fromEntries(
    names.map((name) => [name, execFileSync('git', ['show', `${branch}:${name}`], { cwd: origin, env: { ...process.env, ...GIT_ENV } })]),
  );
};

const lines = (ticket: number, ...names: string[]): string =>
  names
    .flatMap((name) => [390, 1280].map((w) => `![${name} ${w}](https://github.com/Proprio/Essai/blob/captures/${ticket}/${name}-${w}.png?raw=true)`))
    .join('\n');

describe('scripts/captures.sh', () => {
  it('prints its usage and exits 2 without a scenario name', () => {
    const result = run([]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^usage : scripts\/captures\.sh/);
    expect(pnpmCalls()).toEqual([]);
  });

  it('refuses to run with NODE_ENV=production', () => {
    const result = run(['blank'], { NODE_ENV: ' Production ' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/production/);
    expect(pnpmCalls()).toEqual([]);
  });

  it('pushes the two captures of a scenario to captures/<n>, an orphan branch, and prints their Markdown lines', () => {
    const result = run(['blank']);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd()).toBe(lines(12, 'blank'));

    const [call] = pnpmCalls();
    expect(call?.slice(0, 2)).toEqual(['exec nx e2e web -- captures.spec.ts', 'blank']);
    const files = branchFiles('captures/12');
    expect(Object.keys(files).sort()).toEqual(['blank-1280.png', 'blank-390.png']);
    expect(width(files['blank-390.png'] ?? Buffer.alloc(20))).toBe(390);
    expect(width(files['blank-1280.png'] ?? Buffer.alloc(20))).toBe(1280);
    expect(git(origin, 'rev-list', '--count', 'captures/12')).toBe('1');
    expect(git(origin, 'log', '-1', '--format=%s', 'captures/12')).toBe('captures(#12) : blank');
  });

  it('run again, replaces the captures in a new commit, and keeps those of the other scenarios', () => {
    expect(run(['blank', 'a-toi-vide']).status).toBe(0);

    const again = run(['blank'], { STUB_RUN: '2' });

    expect(again.stderr).toBe('');
    expect(again.status).toBe(0);
    expect(again.stdout.trimEnd()).toBe(lines(12, 'blank'));
    expect(git(origin, 'rev-list', '--count', 'captures/12')).toBe('2');
    expect(git(origin, 'log', '-1', '--format=%s', 'captures/12')).toBe('captures(#12) : blank');
    const files = branchFiles('captures/12');
    expect(Object.keys(files).sort()).toEqual(['a-toi-vide-1280.png', 'a-toi-vide-390.png', 'blank-1280.png', 'blank-390.png']);
    expect(files['blank-390.png']?.toString('latin1')).toMatch(/run 2 blank$/);
    expect(files['a-toi-vide-390.png']?.toString('latin1')).toMatch(/run 1 a-toi-vide$/);
  });

  it('makes a new commit even when the captures did not change', () => {
    expect(run(['blank']).status).toBe(0);

    const again = run(['blank']);

    expect(again.status).toBe(0);
    expect(git(origin, 'rev-list', '--count', 'captures/12')).toBe('2');
  });

  it('takes several scenarios in one run, in one commit', () => {
    const result = run(['a-toi', 'a-toi-vide']);

    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd()).toBe(lines(12, 'a-toi', 'a-toi-vide'));
    expect(pnpmCalls().map((call) => call[1])).toEqual(['a-toi,a-toi-vide']);
    expect(git(origin, 'log', '-1', '--format=%s', 'captures/12')).toBe('captures(#12) : a-toi, a-toi-vide');
  });

  it('leaves neither its worktree, nor a local branch, nor its temporary captures', () => {
    expect(run(['blank']).status).toBe(0);

    expect(git(checkout, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    expect(git(checkout, 'branch', '--list', 'captures/*')).toBe('');
    expect(git(checkout, 'branch', '--show-current')).toBe('chore/12-x');
    const captures = pnpmCalls()[0]?.[2] ?? '';
    expect(captures).not.toBe('');
    expect(existsSync(captures)).toBe(false);
  });

  it.each([['feat/34-a-toi'], ['fix/7-b']])('finds the ticket from the branch %s', (branch) => {
    git(checkout, 'switch', '-qc', branch);

    const result = run(['blank']);

    const ticket = Number(branch.split('/')[1]?.split('-')[0]);
    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd()).toBe(lines(ticket, 'blank'));
    expect(git(origin, 'branch', '--list', `captures/${ticket}`)).toContain(`captures/${ticket}`);
  });

  it('takes --ticket <n> on a branch without a ticket number, and fails without it', () => {
    git(checkout, 'switch', '-qc', 'develop-essai');

    const without = run(['blank']);
    const withTicket = run(['--ticket', '5', 'blank']);

    expect(without.status).toBe(1);
    expect(without.stderr).toMatch(/--ticket/);
    expect(withTicket.status).toBe(0);
    expect(withTicket.stdout.trimEnd()).toBe(lines(5, 'blank'));
  });

  it.each([
    ['the tests fail', { STUB_FAIL: '1' }, /captures/],
    ['a capture is missing', { STUB_MISSING: 'blank-1280' }, /blank-1280\.png/],
    ['a capture has the wrong width', { STUB_WIDTH: '800' }, /800/],
  ])('pushes nothing when %s', (_, env, message) => {
    const result = run(['blank'], env);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
    expect(result.stdout).toBe('');
    expect(git(origin, 'branch', '--list', 'captures/*')).toBe('');
  });

  it('refuses a scenario name that is not a screen id', () => {
    const result = run(['../blank']);

    expect(result.status).toBe(2);
    expect(pnpmCalls()).toEqual([]);
  });
});
