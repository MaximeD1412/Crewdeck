/**
 * `ci/production-sha.sh`, the first step of the workflow `delivery`'s job
 * `production`, run for real in a temporary git repository: `main` advances by
 * a merge commit of `develop` whose tree is `develop`'s, and the script prints
 * that `develop` commit, the one whose image staging ran. Anything else fails
 * before the job reaches its SSH step.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '../ci/production-sha.sh');
const IDENTITY = ['-c', 'user.name=essai', '-c', 'user.email=essai@example.invalid', '-c', 'commit.gpgsign=false'];
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

let repo: string;

const git = (...args: string[]): string =>
  execFileSync('git', [...IDENTITY, ...args], { cwd: repo, encoding: 'utf8', env: GIT_ENV }).trim();

const commit = (file: string, content: string): string => {
  writeFileSync(join(repo, file), content);
  git('add', file);
  git('commit', '-q', '-m', `${file}: ${content}`);
  return git('rev-parse', 'HEAD');
};

function productionSha() {
  const result = spawnSync(SCRIPT, [], { cwd: repo, encoding: 'utf8', env: GIT_ENV });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'crewdeck-production-sha-'));
  git('init', '-q', '-b', 'main');
  commit('a.txt', 'one');
  git('switch', '-q', '-c', 'develop');
  commit('b.txt', 'two');
  git('switch', '-q', 'main');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('production-sha.sh', () => {
  it("prints develop's commit for a merge commit whose tree is develop's", () => {
    const develop = git('rev-parse', 'develop');
    git('merge', '-q', '--no-ff', '-m', 'release', 'develop');

    expect(productionSha()).toEqual({ status: 0, stdout: develop, stderr: '' });
  });

  it('fails when main is not a merge commit', () => {
    git('merge', '-q', '--ff-only', 'develop');
    const result = productionSha();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('::error::');
    expect(result.stderr).toContain('commit de merge');
  });

  it("fails when main's tree differs from develop's", () => {
    commit('hotfix.txt', 'only on main');
    git('merge', '-q', '--no-ff', '-m', 'release', 'develop');
    const result = productionSha();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('main contient autre chose que develop');
  });

  it('fails for a merge with more than two parents', () => {
    git('switch', '-q', '-c', 'other', 'main');
    commit('c.txt', 'three');
    git('switch', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'octopus', 'develop', 'other');
    const result = productionSha();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('commit de merge');
  });
});
