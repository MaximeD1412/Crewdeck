/**
 * `scripts/worktree.sh` run for real, in a temporary git repository with a
 * worktree beside it, with a `PATH` whose `docker`, `mise`, `pnpm`, `go` and
 * `pg_isready` are stubs recording their calls: no install, no container.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '../worktree.sh');

/** One line per call: the stub's name, its arguments, `NODE_ENV` and `DB_PORT` (`<unset>` when absent) and its directory. */
const RECORD = `printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$(basename "$0")" "$*" "\${NODE_ENV-<unset>}" "\${DB_PORT-<unset>}" "$PWD" >> "$STUB_LOG"`;

const STUBS: Record<string, string> = {
  mise: RECORD,
  pnpm: RECORD,
  go: RECORD,
  // The TCP check from the host: open (`STUB_PORT=open`), open once the container restarted, or closed.
  pg_isready: `${RECORD}
case "$STUB_PORT" in
  open) exit 0 ;;
  after-restart) [[ -e $STUB_STATE/restarted ]] && exit 0 || exit 2 ;;
  *) exit 2 ;;
esac`,
  docker: `${RECORD}
case " $* " in
  *" ps "*) [[ $STUB_DB == running ]] && echo 0123456789ab; exit 0 ;;
  *" restart db "*) touch "$STUB_STATE/restarted" ;;
  *" exec -T db pg_isready "*) exit 0 ;;
  *" exec -T db psql "*SELECT*) [[ -n \${STUB_DATABASES-} ]] && printf '%s\\n' $STUB_DATABASES; exit 0 ;;
esac`,
};

interface Call {
  name: string;
  args: string;
  nodeEnv: string;
  dbPort: string;
  cwd: string;
}

interface Repository {
  main: string;
  worktree: string;
  run: (command: string, scenario?: Record<string, string>, cwd?: string) => { status: number | null; stdout: string; stderr: string };
  calls: () => Call[];
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=essai', '-c', 'user.email=', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });

const write = (path: string, content: string): void => {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

let temporary: string;

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'worktree-sh-'));
});

afterEach(() => {
  rmSync(temporary, { recursive: true, force: true });
});

/** A main checkout `Crewdeck` with its untracked `.env*`, and a worktree beside it. */
const repository = (name = 'Crewdeck-feat-1-essai'): Repository => {
  const main = join(temporary, 'Crewdeck');
  write(join(main, '.gitignore'), '.env\ndist/\n.nx/\n');
  write(join(main, '.env.example'), 'DB_PORT=5432\n');
  write(join(main, 'docker-compose.yml'), 'services: {}\n');
  write(join(main, 'apps/runner/go.mod'), 'module example.invalid/runner\n');
  write(join(main, 'apps/server/prisma/schema.prisma'), '\n');
  git(temporary, 'init', '-q', '-b', 'develop', main);
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'initial');
  // Ignored, untracked, and a tracked file changed in the main checkout only.
  write(join(main, '.env'), 'DB_PORT=5432\nDATABASE_URL=postgresql://localhost:5432/crewdeck\n');
  write(join(main, '.env.local'), 'LOCAL=1\n');
  write(join(main, '.env.example'), 'DB_PORT=9999\n');

  const worktree = join(temporary, name);
  git(main, 'worktree', 'add', '-q', '-b', 'feat/essai', worktree);

  const stubs = join(temporary, 'stubs');
  const state = join(temporary, 'state');
  mkdirSync(state);
  for (const [name, body] of Object.entries(STUBS)) {
    write(join(stubs, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(stubs, name), 0o755);
  }
  const log = join(temporary, 'calls.log');

  return {
    main,
    worktree,
    run: (command, scenario = {}, cwd = worktree) => {
      const result = spawnSync('bash', [SCRIPT, command], {
        cwd,
        encoding: 'utf8',
        env: {
          PATH: `${stubs}:/usr/bin:/bin`,
          HOME: temporary,
          GIT_CONFIG_GLOBAL: '/dev/null',
          NODE_ENV: 'production',
          STUB_LOG: log,
          STUB_STATE: state,
          STUB_DB: 'running',
          STUB_PORT: 'open',
          ...scenario,
        },
      });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    calls: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .trimEnd()
            .split('\n')
            .map((line) => {
              const [name = '', args = '', nodeEnv = '', dbPort = '', cwd = ''] = line.split('\t');
              return { name, args, nodeEnv, dbPort, cwd };
            })
        : [],
  };
};

const command = (call: Call): string => `${call.name} ${call.args}`;

describe('scripts/worktree.sh setup', () => {
  it('copies the untracked .env files of the main checkout, then installs the toolchain and the dependencies in order', () => {
    const { main, worktree, run, calls } = repository();

    const result = run('setup');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(readFileSync(join(worktree, '.env'), 'utf8')).toBe(readFileSync(join(main, '.env'), 'utf8'));
    expect(readFileSync(join(worktree, '.env.local'), 'utf8')).toBe('LOCAL=1\n');
    // A tracked file is never copied: the worktree keeps its checkout.
    expect(readFileSync(join(worktree, '.env.example'), 'utf8')).toBe('DB_PORT=5432\n');

    const steps = calls().filter((call) => ['mise install', 'pnpm', 'go'].some((name) => command(call).startsWith(name)));
    expect(steps.map((call) => [command(call), call.cwd])).toEqual([
      ['mise install', worktree],
      ['pnpm install --frozen-lockfile --prefer-offline', worktree],
      ['pnpm --dir apps/server exec prisma generate', worktree],
      ['go mod download', join(worktree, 'apps/runner')],
    ]);
    expect(steps[1]?.nodeEnv).toBe('<unset>');
  });

  it('never overwrites a .env the worktree already has', () => {
    const { worktree, run } = repository();
    write(join(worktree, '.env'), 'DB_PORT=5432\nMINE=1\n');

    const result = run('setup');

    expect(result.status).toBe(0);
    expect(readFileSync(join(worktree, '.env'), 'utf8')).toBe('DB_PORT=5432\nMINE=1\n');
    expect(result.stdout).toContain('.env déjà présent');
  });

  it('checks the running PostgreSQL inside its container and from the host, on the DB_PORT of .env', () => {
    const { main, worktree, run, calls } = repository();
    write(join(main, '.env'), 'DB_PORT=5433\n');

    const result = run('setup');

    expect(result.status).toBe(0);
    const docker = calls().filter((call) => call.name === 'docker').map((call) => call.args);
    expect(docker.some((args) => args.includes('exec -T db pg_isready'))).toBe(true);
    expect(docker.some((args) => / (restart|up) /.test(args))).toBe(false);
    expect(calls().filter((call) => call.name === 'pg_isready').map((call) => call.args)).toContain('-h localhost -p 5433 -t 3');
    // The shared container is the main checkout's compose project, never one of the worktree's, from the
    // worktree's compose file: the main checkout may lag behind.
    expect(docker.every((args) => args.startsWith(`compose -p crewdeck -f ${join(worktree, 'docker-compose.yml')} `))).toBe(true);
  });

  it('publishes the container on the DB_PORT of the worktree .env', () => {
    const { main, run, calls } = repository();
    write(join(main, '.env'), 'DB_PORT=5433\n');

    const result = run('setup', { STUB_DB: 'absent' });

    expect(result.status).toBe(0);
    const docker = calls().filter((call) => call.name === 'docker');
    expect(docker.length).toBeGreaterThan(0);
    expect(docker.every((call) => call.dbPort === '5433')).toBe(true);
  });

  it('restarts the running container once when its host port does not answer, and succeeds', () => {
    const { run, calls } = repository();

    const result = run('setup', { STUB_PORT: 'after-restart' });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const docker = calls().filter((call) => call.name === 'docker').map((call) => call.args);
    expect(docker.filter((args) => args.endsWith(' restart db'))).toHaveLength(1);
    expect(docker.findIndex((args) => args.endsWith(' up -d --wait db'))).toBeGreaterThan(
      docker.findIndex((args) => args.endsWith(' restart db')),
    );
  });

  it('fails with the port when PostgreSQL still does not answer after one restart', () => {
    const { main, run, calls } = repository();
    write(join(main, '.env'), 'DB_PORT="5433"\n');

    const result = run('setup', { STUB_PORT: 'closed' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PostgreSQL ne répond pas sur le port 5433');
    expect(calls().filter((call) => call.name === 'docker' && call.args.endsWith(' restart db'))).toHaveLength(1);
  });

  it('starts the container when it is absent', () => {
    const { run, calls } = repository();

    const result = run('setup', { STUB_DB: 'absent' });

    expect(result.status).toBe(0);
    const docker = calls().filter((call) => call.name === 'docker').map((call) => call.args);
    expect(docker.filter((args) => args.endsWith(' up -d --wait db'))).toHaveLength(1);
    expect(docker.some((args) => args.endsWith(' restart db'))).toBe(false);
  });

  it.each([
    ['a comment after the value', 'DB_PORT=5433 # port local\n'],
    ['trailing spaces and spaces around =', 'DB_PORT = 5433   \n'],
    ['single quotes and a comment', "export DB_PORT='5433' # local\n"],
    ['double quotes', 'DB_PORT="5433"\n'],
    ['Windows line endings', 'DB_PORT=5433\r\n'],
    ['the last line winning, commented lines skipped', 'DB_PORT=5000\n# DB_PORT=6000\nDB_PORT=5433\n'],
  ])('reads DB_PORT as Node parses .env, with %s', (_, content) => {
    const { main, run, calls } = repository();
    write(join(main, '.env'), content);

    const result = run('setup');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(calls().filter((call) => call.name === 'pg_isready').map((call) => call.args)).toEqual(['-h localhost -p 5433 -t 3']);
    expect(calls().filter((call) => call.name === 'docker').every((call) => call.dbPort === '5433')).toBe(true);
  });

  it('fails clearly on a DB_PORT that is not a port', () => {
    const { main, run, calls } = repository();
    write(join(main, '.env'), 'DB_PORT=cinq\n');

    const result = run('setup');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DB_PORT invalide dans .env : « cinq »');
    expect(calls().some((call) => call.name === 'docker')).toBe(false);
  });

  it('reads the default port 5432 when .env has no DB_PORT', () => {
    const { main, run, calls } = repository();
    rmSync(join(main, '.env'));

    const result = run('setup');

    expect(result.status).toBe(0);
    expect(calls().filter((call) => call.name === 'pg_isready').map((call) => call.args)).toContain('-h localhost -p 5432 -t 3');
  });
});

describe('scripts/worktree.sh drop', () => {
  const dropped = (calls: Call[]): string[] =>
    calls
      .filter((call) => call.name === 'docker' && call.args.includes('DROP DATABASE'))
      .map((call) => /DROP DATABASE IF EXISTS "([^"]+)"/.exec(call.args)?.[1] ?? call.args);

  it("stops the Nx daemon, removes the worktree's outputs and drops only its own integration databases", () => {
    const { worktree, run, calls } = repository();
    for (const output of ['dist/server/main.js', '.nx/cache/hash', 'test-results/a.txt', 'playwright-report/index.html', '.nx/workspace-data/x']) {
      write(join(worktree, output), 'x');
    }

    const result = run('drop', {
      STUB_DATABASES: [
        'crewdeck',
        'crewdeck_it_crewdeck_feat_1_essai_0a1b2c3d',
        'crewdeck_it_crewdeck_feat_1_essai_deadbeef',
        // Other worktrees: Crewdeck-feat-1-essai-2, Crewdeck-feat-12, and a name that is not a run's.
        'crewdeck_it_crewdeck_feat_1_essai_2_0a1b2c3d',
        'crewdeck_it_crewdeck_feat_12_0a1b2c3d',
        'crewdeck_it_crewdeck_feat_1_essai_keep',
      ].join(' '),
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(calls().map(command)).toContain('pnpm exec nx daemon --stop');
    expect(dropped(calls())).toEqual(['crewdeck_it_crewdeck_feat_1_essai_0a1b2c3d', 'crewdeck_it_crewdeck_feat_1_essai_deadbeef']);
    for (const output of ['dist', '.nx/cache', 'test-results', 'playwright-report']) {
      expect(existsSync(join(worktree, output)), output).toBe(false);
    }
    expect(existsSync(join(worktree, '.nx/workspace-data/x'))).toBe(true);
    expect(
      calls()
        .filter((call) => call.name === 'docker')
        .every((call) => call.args.startsWith(`compose -p crewdeck -f ${join(worktree, 'docker-compose.yml')} `)),
    ).toBe(true);
  });

  it('cuts a long slug as the integration setup does', () => {
    const { run, calls } = repository('Crewdeck-feat-23-infra-2-scripts-worktree-sh-setup-and-dr');
    // `databaseName` of apps/server/test/integration/database.ts: the slug cut to 42 characters, within 63 bytes.
    const own = 'crewdeck_it_crewdeck_feat_23_infra_2_scripts_worktree__0a1b2c3d';

    const result = run('drop', { STUB_DATABASES: `${own} crewdeck_it_crewdeck_feat_23_infra_2_scripts_worktree_sh_0a1b2c3d` });

    expect(result.status).toBe(0);
    expect(dropped(calls())).toEqual([own]);
  });

  it('drops no database when another worktree has the same cut slug, and says so', () => {
    const { main, worktree, run, calls } = repository('Crewdeck-feat-23-infra-2-scripts-worktree-sh-setup');
    const other = join(temporary, 'Crewdeck-feat-23-infra-2-scripts-worktree-sh-drop');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/autre', other);
    write(join(worktree, 'dist/a'), 'x');
    // Whose run made it cannot be told: both worktrees' slugs are `crewdeck_feat_23_infra_2_scripts_worktree_`.
    const shared = 'crewdeck_it_crewdeck_feat_23_infra_2_scripts_worktree__0a1b2c3d';

    const result = run('drop', { STUB_DATABASES: shared });

    expect(result.status).toBe(0);
    expect(dropped(calls())).toEqual([]);
    expect(result.stdout).toContain(`même préfixe de base que ${other}`);
    expect(existsSync(join(worktree, 'dist'))).toBe(false);
  });

  it('still cleans the worktree when PostgreSQL is not running', () => {
    const { worktree, run, calls } = repository();
    write(join(worktree, 'dist/a'), 'x');

    const result = run('drop', { STUB_DB: 'absent' });

    expect(result.status).toBe(0);
    expect(existsSync(join(worktree, 'dist'))).toBe(false);
    expect(dropped(calls())).toEqual([]);
    expect(result.stdout).toContain('conteneur db arrêté');
  });
});

describe('scripts/worktree.sh usage', () => {
  it.each(['help', 'nettoie', ''])('prints the usage and exits 2 for %j', (name) => {
    const { run, calls } = repository();

    const result = run(name);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage : scripts/worktree.sh setup|drop');
    expect(calls()).toEqual([]);
  });

  it('refuses to run in the main checkout', () => {
    const { main, run, calls } = repository();

    const result = run('drop', {}, main);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pas dans le dépôt principal');
    expect(calls()).toEqual([]);
  });
});
