/**
 * The bench of the backup scripts: a temporary `/opt/crewdeck`
 * (`CREWDECK_ROOT`) and a `PATH` whose `docker` and `restic` are stubs. No
 * registry, no container, no restic repository, no provider.
 *
 * The stub of `docker` keeps the containers and networks it was asked to
 * create in a state directory, so that a test sees what a script leaves
 * behind. The stub of `restic` keeps one snapshot, a file: `backup` writes the
 * output of the command given after `--` into it, `dump` prints it back.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const BIN = resolve(import.meta.dirname, '../../bin');
export const DEPLOY_BIN = resolve(import.meta.dirname, '../../../deploy/bin');
export const IMAGE = 'ghcr.io/maximed1412/crewdeck-server';
export const DUMP = 'PGDMP custom-format dump of crewdeck-prod';

/**
 * One line per call in `$STUB_LOG`: `docker <args>`.
 *
 * - `compose … exec -T db pg_dump …` prints `$DUMP`, or exits
 *   `STUB_PG_DUMP_STATUS`; `compose … run --rm server migrate` (production's
 *   own migration) exits 0; `compose … exec` (the deploy's health check)
 *   answers healthy for the sha of the env file;
 * - `network create|rm <name>`, `run [-d] [--rm] --name <name> …` and
 *   `rm -f <name>…` keep `$STUB_STATE/{network,container}-<name>`; a `run`
 *   whose command is `migrate` exits `STUB_MIGRATE_STATUS`, and leaves its
 *   container behind unless `--rm`;
 * - `exec <c> pg_isready` answers for a container that exists; `exec -i <c>
 *   pg_restore` keeps its stdin in `$STUB_STATE/restored-<c>` and exits
 *   `STUB_RESTORE_STATUS`; `exec <c> psql` prints `STUB_MIGRATIONS`.
 */
const DOCKER = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$STUB_LOG"
state=$STUB_STATE
case "$1" in
  compose)
    case " $* " in
      *" exec -T db pg_dump "*)
        [ "\${STUB_PG_DUMP_STATUS:-0}" = 0 ] || { echo "pg_dump: error: connection failed" >&2; exit "$STUB_PG_DUMP_STATUS"; }
        printf '%s' "$STUB_DUMP"; exit 0 ;;
      *" run --rm server migrate "*) exit 0 ;;
      *" exec "*)
        env_file=; prev=
        for arg in "$@"; do [[ $prev == --env-file ]] && env_file=$arg; prev=$arg; done
        echo "200 ok $(sed -n 's/^CREWDECK_SHA=//p' "$env_file") ok"; exit 0 ;;
    esac
    exit 0 ;;
  login) cat > /dev/null; exit 0 ;;
  pull) exit 0 ;;
  image) echo sha256:validated; exit 0 ;;
  network)
    case "$2" in
      create) touch "$state/network-$3" ;;
      rm) [ -e "$state/network-$3" ] || exit 1; rm -f "$state/network-$3" ;;
    esac
    exit 0 ;;
  run)
    shift; name=; detach=0; remove=0; last=
    while [ $# -gt 0 ]; do
      case "$1" in
        -d|--detach) detach=1 ;;
        --rm) remove=1 ;;
        --name) name=$2; shift ;;
        -e|--env|--network|--label) shift ;;
        *) last=$1 ;;
      esac
      shift
    done
    if [ "$last" = migrate ]; then
      [ "$remove" = 1 ] || touch "$state/container-$name"
      exit "\${STUB_MIGRATE_STATUS:-0}"
    fi
    touch "$state/container-$name"
    exit 0 ;;
  exec)
    shift; [ "$1" = -i ] && shift
    container=$1; shift
    [ -e "$state/container-$container" ] || { echo "No such container: $container" >&2; exit 1; }
    case "$1" in
      pg_isready) exit 0 ;;
      pg_restore) cat > "$state/restored-$container"; exit "\${STUB_RESTORE_STATUS:-0}" ;;
      psql) echo "\${STUB_MIGRATIONS:-12}"; exit 0 ;;
    esac
    exit 0 ;;
  rm)
    shift
    for arg in "$@"; do [[ $arg == -* ]] || rm -f "$state/container-$arg"; done
    exit 0 ;;
esac
exit 0
`;

/**
 * One line per call in `$STUB_LOG`: `restic <args> [RESTIC_REPOSITORY=…]`.
 * `STUB_RESTIC_FAILS` lists the subcommands that fail; `STUB_SNAPSHOT_TIME`,
 * when set, is the time of the one snapshot `snapshots` lists.
 */
const RESTIC = `#!/usr/bin/env bash
printf 'restic %s [RESTIC_REPOSITORY=%s]\\n' "$*" "\${RESTIC_REPOSITORY-}" >> "$STUB_LOG"
[[ " \${STUB_RESTIC_FAILS-} " == *" $1 "* ]] && { echo "Fatal: unable to open repository" >&2; exit 1; }
case "$1" in
  version) echo "restic \${STUB_RESTIC_VERSION:-0.18.1} compiled with go1.25.1 on linux/amd64" ;;
  backup)
    while [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done
    shift
    "$@" > "$STUB_STATE/snapshot.tmp" || { rm -f "$STUB_STATE/snapshot.tmp"; echo "Fatal: command failed" >&2; exit 1; }
    mv "$STUB_STATE/snapshot.tmp" "$STUB_STATE/snapshot" ;;
  snapshots)
    if [ -n "\${STUB_SNAPSHOT_TIME-}" ]; then
      printf '[{"time":"%s","paths":["/crewdeck-prod.dump"],"hostname":"vps","tags":["prod"],"summary":{"backup_start":"2000-01-01T00:00:00Z"},"id":"70d3d6c0857f63f2c662bf5bee680dc5043050343e07a886f52d9fdddb8f63ea","short_id":"70d3d6c0"}]\\n' "$STUB_SNAPSHOT_TIME"
    else
      echo '[]'
    fi ;;
  dump) cat "$STUB_STATE/snapshot" ;;
esac
`;

export interface Bench {
  /** The temporary `/opt/crewdeck`. */
  root: string;
  state: string;
  env: NodeJS.ProcessEnv;
}

const executable = (path: string, content: string): void => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};

export const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

/** A bench under `temporary`, with `restic.env` written unless `resticEnv: false`. */
export function bench(temporary: string, options: { resticEnv?: boolean } = {}): Bench {
  const root = join(temporary, 'opt');
  const stubs = join(temporary, 'stubs');
  const state = join(temporary, 'state');
  for (const dir of [stubs, state, join(root, 'backup')]) mkdirSync(dir, { recursive: true });
  const password = join(root, 'backup/restic-password');
  writeFileSync(password, 'not-a-real-password\n');
  if (options.resticEnv !== false) {
    writeFileSync(
      join(root, 'backup/restic.env'),
      `RESTIC_REPOSITORY=s3:https://s3.example.invalid/crewdeck-backup\nRESTIC_PASSWORD_FILE=${password}\nAWS_ACCESS_KEY_ID=fake\nAWS_SECRET_ACCESS_KEY=fake\n`,
    );
  }
  executable(join(stubs, 'docker'), DOCKER);
  executable(join(stubs, 'restic'), RESTIC);
  executable(join(stubs, 'logger'), '#!/usr/bin/env bash\nexit 0\n');
  return {
    root,
    state,
    env: {
      ...process.env,
      PATH: `${stubs}:${process.env.PATH}`,
      CREWDECK_ROOT: root,
      STUB_LOG: join(state, 'calls.log'),
      STUB_STATE: state,
      STUB_DUMP: DUMP,
      // The stubbed PostgreSQL answers at once.
      READY_INTERVAL: '0',
    },
  };
}

export function run(b: Bench, script: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(script, args, { encoding: 'utf8', env: { ...b.env, ...extra } });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

export const calls = (b: Bench): string[] => read(join(b.state, 'calls.log')).split('\n').filter(Boolean);
export const index = (b: Bench, needle: string): number => calls(b).findIndex((call) => call.includes(needle));

/** The containers and networks the stub of `docker` still has. */
export const leftovers = (b: Bench): string[] =>
  readdirSync(b.state).filter((name) => name.startsWith('container-') || name.startsWith('network-'));

export const temporaryDir = (): string => mkdtempSync(join(tmpdir(), 'crewdeck-backup-'));
export const remove = (dir: string): void => rmSync(dir, { recursive: true, force: true });
