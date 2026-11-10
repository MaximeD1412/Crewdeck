/**
 * `bin/deploy.sh <env> <sha>` run for real against a temporary
 * `/opt/crewdeck` (`CREWDECK_ROOT`), with a `PATH` whose `docker` and `logger`
 * are stubs: `docker` records each call with the `CREWDECK_SHA` of the env
 * file it is given, and answers the health check with the sha of that file
 * (the server runs the image the file names) unless told otherwise. `flock`
 * is the machine's own: two runs really race for the lock. No registry, no
 * container, no journal.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DEPLOY = resolve(import.meta.dirname, '../bin/deploy.sh');
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const PREVIOUS = '0f1e2d3c4b5a69788796a5b4c3d2e1f001234567';
const OTHER = 'ffffffffffffffffffffffffffffffffffffffff';
const TOKEN = 'ghcr-token-that-never-leaks';
const IMAGE = 'ghcr.io/maximed1412/crewdeck-server';

/**
 * The stub of `docker`: one line per call, `<CREWDECK_SHA of --env-file>\t<args>`.
 * `STUB_BROKEN` lists the shas whose server answers the health check with another
 * commit; `STUB_MIGRATE_STATUS` is the exit code of `migrate`; `STUB_PULL_GATE`
 * makes `pull` touch `<gate>.started` and wait for `<gate>`.
 */
const DOCKER = `#!/usr/bin/env bash
env_file=
prev=
for arg in "$@"; do
  [[ $prev == --env-file ]] && env_file=$arg
  prev=$arg
done
sha=
[[ -n $env_file ]] && sha=$(sed -n 's/^CREWDECK_SHA=//p' "$env_file")
printf '%s\\t%s\\n' "$sha" "$*" >> "$STUB_LOG"
case " $* " in
  *" login "*) cat > "$STUB_LOG.stdin" ;;
  *" pull "*)
    if [[ -n \${STUB_PULL_GATE-} ]]; then
      touch "$STUB_PULL_GATE.started"
      for _ in $(seq 200); do [[ -e $STUB_PULL_GATE ]] && break; sleep 0.05; done
    fi ;;
  *" run "*" migrate "*) exit "\${STUB_MIGRATE_STATUS:-0}" ;;
  *" exec "*)
    commit=$sha
    [[ " \${STUB_BROKEN-} " == *" $sha "* ]] && commit=${OTHER}
    echo "200 ok $commit ok" ;;
esac
exit 0
`;

const LOGGER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_JOURNAL"
`;

const REHEARSE = `#!/usr/bin/env bash
printf 'rehearse %s\\n' "$*" >> "$STUB_LOG"
exit "\${STUB_REHEARSE_STATUS:-0}"
`;

interface Bench {
  root: string;
  env: NodeJS.ProcessEnv;
  log: string;
  journal: string;
}

let temporary: string;

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'crewdeck-deploy-'));
});

afterEach(() => rmSync(temporary, { recursive: true, force: true }));

const executable = (path: string, content: string): void => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

/** `/opt/crewdeck` with both environments deployed at `PREVIOUS`. */
function bench(options: { rehearse?: boolean; current?: string | null } = {}): Bench {
  const root = join(temporary, 'opt');
  const stubs = join(temporary, 'stubs');
  for (const dir of [stubs, join(root, 'deploy/bin'), join(root, 'prod'), join(root, 'staging'), join(temporary, 'lock')]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(root, 'deploy/docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(root, 'deploy/docker-compose.staging.yml'), 'services: {}\n');
  writeFileSync(join(root, 'deploy/ghcr.env'), `GHCR_USERNAME=crewdeck-deploy\nGHCR_TOKEN=${TOKEN}\n`);
  const current = options.current === undefined ? PREVIOUS : options.current;
  for (const dir of ['prod', 'staging']) {
    writeFileSync(join(root, dir, '.env'), `CREWDECK_ENV=${dir}\nCREWDECK_SHA=${current ?? ''}\nPOSTGRES_PASSWORD=abc\n`);
    if (current) writeFileSync(join(root, dir, 'current-sha'), `${current}\n`);
  }
  if (options.rehearse) executable(join(root, 'deploy/bin/rehearse.sh'), REHEARSE);
  executable(join(stubs, 'docker'), DOCKER);
  executable(join(stubs, 'logger'), LOGGER);

  const log = join(temporary, 'docker.log');
  const journal = join(temporary, 'journal.log');
  return {
    root,
    log,
    journal,
    env: {
      ...process.env,
      PATH: `${stubs}:${process.env.PATH}`,
      CREWDECK_ROOT: root,
      DEPLOY_LOCK_DIR: join(temporary, 'lock'),
      HEALTH_TIMEOUT: '1',
      HEALTH_INTERVAL: '0.1',
      STUB_LOG: log,
      STUB_JOURNAL: journal,
    },
  };
}

function deploy(b: Bench, args: string[], extra: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(DEPLOY, args, { encoding: 'utf8', env: { ...b.env, ...extra } });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const calls = (b: Bench): string[] => read(b.log).split('\n').filter(Boolean);
const index = (b: Bench, needle: string): number => calls(b).findIndex((call) => call.includes(needle));
const envSha = (b: Bench, dir: string): string | undefined =>
  /^CREWDECK_SHA=(.*)$/m.exec(read(join(b.root, dir, '.env')))?.[1];

describe('deploy.sh: a deploy that succeeds', () => {
  it('logs in, pulls, migrates with the new sha, then starts it and checks its health', () => {
    const b = bench();
    const result = deploy(b, ['staging', SHA]);

    expect(result.status).toBe(0);
    const login = index(b, '\tlogin ghcr.io');
    const pull = index(b, `pull --quiet ${IMAGE}:${SHA}`);
    const migrate = calls(b).findIndex((call) => call.startsWith(`${SHA}\t`) && call.includes('run --rm server migrate'));
    const up = calls(b).findIndex((call) => call.startsWith(`${SHA}\t`) && call.includes('up -d'));
    const health = index(b, ' exec ');
    expect(login).toBeGreaterThanOrEqual(0);
    expect(login).toBeLessThan(pull);
    expect(pull).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(up);
    expect(up).toBeLessThan(health);
  });

  it('writes the sha in the env file, keeping its other keys, and in current-sha', () => {
    const b = bench();
    deploy(b, ['staging', SHA]);

    expect(read(join(b.root, 'staging/.env'))).toBe(`CREWDECK_ENV=staging\nCREWDECK_SHA=${SHA}\nPOSTGRES_PASSWORD=abc\n`);
    expect(read(join(b.root, 'staging/current-sha'))).toBe(`${SHA}\n`);
    expect(envSha(b, 'prod')).toBe(PREVIOUS);
  });

  it("runs staging's Compose project with its override, production's without", () => {
    const b = bench();
    deploy(b, ['staging', SHA]);
    deploy(b, ['production', SHA]);

    const ups = calls(b).filter((call) => call.includes(' up -d'));
    expect(ups[0]).toContain('-p crewdeck-staging');
    expect(ups[0]).toContain(`--env-file ${join(b.root, 'staging/.env')}`);
    expect(ups[0]).toContain('docker-compose.staging.yml');
    expect(ups[1]).toContain('-p crewdeck-prod');
    expect(ups[1]).toContain(`--env-file ${join(b.root, 'prod/.env')}`);
    expect(ups[1]).not.toContain('docker-compose.staging.yml');
    expect(envSha(b, 'prod')).toBe(SHA);
  });

  it('checks the health at the address Caddy uses', () => {
    const b = bench();
    deploy(b, ['staging', SHA]);

    expect(read(b.log)).toContain('http://crewdeck-staging-server:3000/api/health');
  });

  it('gives the registry token on stdin only, and never prints it', () => {
    const b = bench();
    const result = deploy(b, ['staging', SHA]);

    expect(read(`${b.log}.stdin`)).toBe(TOKEN);
    expect(read(b.log)).not.toContain(TOKEN);
    expect(result.output).not.toContain(TOKEN);
  });

  it('logs to stdout and to the journal under crewdeck-deploy', () => {
    const b = bench();
    const result = deploy(b, ['staging', SHA]);

    expect(result.output).toContain(`staging déployé sur ${SHA}`);
    expect(read(b.journal)).toContain('-t crewdeck-deploy');
    expect(read(b.journal)).toContain(`staging déployé sur ${SHA}`);
  });
});

describe('deploy.sh: the rehearsal hook', () => {
  it('runs rehearse.sh <sha> before migrating production', () => {
    const b = bench({ rehearse: true });
    const result = deploy(b, ['production', SHA]);

    expect(result.status).toBe(0);
    expect(index(b, `rehearse ${SHA}`)).toBeGreaterThan(index(b, '\tpull '));
    expect(index(b, `rehearse ${SHA}`)).toBeLessThan(index(b, ' migrate'));
  });

  it('never runs it for staging', () => {
    const b = bench({ rehearse: true });
    deploy(b, ['staging', SHA]);

    expect(index(b, 'rehearse')).toBe(-1);
  });

  it('aborts production when it fails, before touching the env file or the containers', () => {
    const b = bench({ rehearse: true });
    const result = deploy(b, ['production', SHA], { STUB_REHEARSE_STATUS: '1' });

    expect(result.status).toBe(1);
    expect(result.output).toContain('répétition');
    expect(index(b, ' migrate')).toBe(-1);
    expect(index(b, ' up ')).toBe(-1);
    expect(envSha(b, 'prod')).toBe(PREVIOUS);
  });

  it('deploys production without it while INFRA-8 has not installed it', () => {
    const b = bench();
    const result = deploy(b, ['production', SHA]);

    expect(result.status).toBe(0);
    expect(result.output).toContain('rehearse.sh absent');
  });
});

describe('deploy.sh: a deploy that fails', () => {
  it('rolls back to the previous sha when the health returns another commit, and exits 1', () => {
    const b = bench();
    const result = deploy(b, ['staging', SHA], { STUB_BROKEN: SHA });

    expect(result.status).toBe(1);
    expect(result.output).toContain(`déploiement de ${SHA} échoué, retour à ${PREVIOUS}`);
    const ups = calls(b).filter((call) => call.includes(' up -d'));
    expect(ups.map((call) => call.split('\t')[0])).toEqual([SHA, PREVIOUS]);
    expect(envSha(b, 'staging')).toBe(PREVIOUS);
    expect(read(join(b.root, 'staging/current-sha'))).toBe(`${PREVIOUS}\n`);
  });

  it('says so when the previous sha does not come back healthy either', () => {
    const b = bench();
    const result = deploy(b, ['staging', SHA], { STUB_BROKEN: `${SHA} ${PREVIOUS}` });

    expect(result.status).toBe(1);
    expect(result.output).toContain(`déploiement de ${SHA} échoué, retour à ${PREVIOUS}`);
    expect(result.output).toContain(`${PREVIOUS} ne répond pas non plus`);
    expect(envSha(b, 'staging')).toBe(PREVIOUS);
  });

  it('does not start the new image when the migration fails, and restores the env file', () => {
    const b = bench();
    const result = deploy(b, ['staging', SHA], { STUB_MIGRATE_STATUS: '1' });

    expect(result.status).toBe(1);
    expect(result.output).toContain('migration');
    expect(index(b, ' up ')).toBe(-1);
    expect(envSha(b, 'staging')).toBe(PREVIOUS);
  });

  it('exits 1 without a rollback target on the first deploy', () => {
    const b = bench({ current: null });
    const result = deploy(b, ['staging', SHA], { STUB_BROKEN: SHA });

    expect(result.status).toBe(1);
    expect(result.output).toContain('aucune version précédente');
    expect(existsSync(join(b.root, 'staging/current-sha'))).toBe(false);
  });

  it.each([
    ['an unknown environment', ['prod', SHA]],
    ['a short sha', ['staging', SHA.slice(0, 7)]],
    ['no sha', ['staging']],
  ])('refuses %s before any docker call', (_case, args) => {
    const b = bench();
    const result = deploy(b, args);

    expect(result.status).toBe(1);
    expect(calls(b)).toEqual([]);
  });
});

describe('deploy.sh: one deploy per environment at a time', () => {
  it('refuses a second deploy of the same environment while the first runs', async () => {
    const b = bench();
    const gate = join(temporary, 'gate');
    const first = spawn(DEPLOY, ['staging', SHA], { env: { ...b.env, STUB_PULL_GATE: gate } });
    const firstDone = new Promise<number | null>((done) => first.on('exit', done));
    for (let i = 0; i < 200 && !existsSync(`${gate}.started`); i++) await new Promise((r) => setTimeout(r, 25));
    expect(existsSync(`${gate}.started`)).toBe(true);

    const second = deploy(b, ['staging', OTHER]);
    const other = deploy(b, ['production', OTHER]);
    writeFileSync(gate, '');

    expect(second.status).toBe(1);
    expect(second.output).toContain('déploiement déjà en cours');
    expect(other.status).toBe(0);
    expect(await firstDone).toBe(0);
    expect(envSha(b, 'staging')).toBe(SHA);
  });
});
