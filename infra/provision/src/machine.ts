/**
 * The throwaway machine of the integration specs: a privileged Ubuntu 24.04
 * container running systemd, from `test/Dockerfile`, with `provision.sh`
 * mounted read-only. Inside it, a network namespace `dehors` plays the
 * Internet: what it reaches is what an attacker would reach.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export const SCRIPT = resolve(import.meta.dirname, '../provision.sh');
export const IMAGE = 'crewdeck-provision-test:24.04';
const DOCKERFILE_DIR = resolve(import.meta.dirname, '../test');

export const ADMIN = 'ops';
/** The admin's key pair, made inside the machine; the provider also put its public half for root. */
export const KEY = '/root/essai/admin';
export const PROVISION = `bash /src/provision.sh --admin-user ${ADMIN} --admin-key ${KEY}.pub`;

/** The machine's address seen from `dehors`, and `dehors`' own two (the second, fail2ban's intruder). */
export const HOST = '192.168.77.1';
export const OUTSIDE = '192.168.77.2';
export const INTRUDER = '192.168.77.3';
export const HOST6 = 'fd77::1';
export const OUTSIDE6 = 'fd77::2';

/** A tiny HTTP server, the container a published port leads to. */
export const BUSYBOX = 'busybox:1.37@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e';

export interface Result {
  status: number;
  stdout: string;
  stderr: string;
}

export const docker = (args: string[]): Result => {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
};

/** A bash script run as root in the machine. */
export const sh = (machine: string, script: string): Result =>
  docker(['exec', machine, 'bash', '-o', 'pipefail', '-c', script]);

/** Like `sh`, and fails the test with the output when the script fails. */
export const must = (machine: string, script: string): string => {
  const result = sh(machine, script);
  if (result.status !== 0) {
    throw new Error(`échec (${result.status}) : ${script}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
};

export const provision = (machine: string): Result => sh(machine, PROVISION);

export const lines = (output: string): string[] => output.split('\n').filter(Boolean);

export const lastLine = (output: string): string => lines(output).at(-1) ?? '';

/** The summary's step lines, `[n/7] <step> : …`. */
export const stepLines = (output: string): string[] => lines(output).filter((line) => /^\[\d\/7\] /.test(line));

/** Every file and link under `/etc`: path, mode, owner and checksum. Two equal states: nothing changed. */
export const ETC_STATE = `find /etc -xdev \\( -type f -o -type l \\) -print0 | sort -z | xargs -0 stat -c '%N %a %U:%G'
find /etc -xdev -type f -print0 | sort -z | xargs -0 sha256sum`;

export const etcState = (machine: string): string => must(machine, ETC_STATE);

/** Since when each service the script manages runs, and as which process: equal, none was restarted. */
export const servicesState = (machine: string): string =>
  must(
    machine,
    'systemctl show -p Id -p MainPID -p ActiveEnterTimestampMonotonic ssh.service fail2ban.service docker.service crewdeck-docker-user.service',
  );

/** A command run from `dehors`. */
export const outside = (machine: string, command: string): Result => sh(machine, `ip netns exec dehors ${command}`);

/** Whether `dehors` opens a TCP connection to `address:port` within 5 s. */
export const reachable = (machine: string, address: string, port: number): boolean =>
  outside(machine, `timeout 5 bash -c 'exec 3<>/dev/tcp/${address}/${port}'`).status === 0;

/** SSH from `dehors`, never interactive. */
export const sshFromOutside = (machine: string, args: string): Result =>
  outside(
    machine,
    `ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 ${args} true`,
  );

export interface Refusal {
  run: Result;
  etcBefore: string;
  etcAfter: string;
  rerun: Result;
}

/**
 * A machine the script must refuse: `setup` makes it so, the script runs
 * (`command`, the usual run by default) and `/etc` is compared around it,
 * `cleanup` puts the machine back, and the script runs again.
 */
export const refusal = (machine: string, setup: string, cleanup: string, command = PROVISION): Refusal => {
  must(machine, setup);
  try {
    const etcBefore = etcState(machine);
    const run = sh(machine, command);
    const etcAfter = etcState(machine);
    must(machine, cleanup);
    return { run, etcBefore, etcAfter, rerun: provision(machine) };
  } catch (error) {
    sh(machine, cleanup);
    throw error;
  }
};

/** The machine, booted: `test/Dockerfile` built, systemd up, `dehors` wired, the admin's key made. */
export const startMachine = (name: string): void => {
  const build = docker(['build', '-q', '-t', IMAGE, DOCKERFILE_DIR]);
  if (build.status !== 0) throw new Error(`docker build : ${build.stderr}`);
  // Docker and containerd of the machine write in volumes: an overlay in an
  // overlay is refused by the kernel.
  const run = docker([
    'run', '-d', '--name', name, '--privileged', '--cgroupns=host',
    '-v', '/sys/fs/cgroup:/sys/fs/cgroup:rw', '--tmpfs', '/run', '--tmpfs', '/run/lock',
    '-v', '/var/lib/docker', '-v', '/var/lib/containerd',
    '-v', `${SCRIPT}:/src/provision.sh:ro`,
    IMAGE,
  ]);
  if (run.status !== 0) throw new Error(`docker run : ${run.stderr}`);
  must(
    name,
    `for _ in $(seq 120); do
       status=$(systemctl is-system-running 2>/dev/null || true)
       [[ $status == running || $status == degraded ]] && exit 0
       sleep 1
     done
     echo "systemd n'a pas démarré ($status)" >&2; exit 1`,
  );
  must(
    name,
    `set -e
     ip netns add dehors
     ip link add veth-hote type veth peer name veth-dehors
     ip link set veth-dehors netns dehors
     ip addr add ${HOST}/24 dev veth-hote
     ip link set veth-hote up
     ip netns exec dehors ip addr add ${OUTSIDE}/24 dev veth-dehors
     ip netns exec dehors ip addr add ${INTRUDER}/24 dev veth-dehors
     ip netns exec dehors ip link set veth-dehors up
     ip netns exec dehors ip link set lo up
     sysctl -qw net.ipv6.conf.veth-hote.disable_ipv6=0
     ip netns exec dehors sysctl -qw net.ipv6.conf.veth-dehors.disable_ipv6=0
     ip addr add ${HOST6}/64 dev veth-hote nodad
     ip netns exec dehors ip addr add ${OUTSIDE6}/64 dev veth-dehors nodad
     mkdir -p /root/essai
     ssh-keygen -q -t ed25519 -N '' -C admin@essai -f ${KEY}
     install -d -m 700 /root/.ssh
     cat ${KEY}.pub >> /root/.ssh/authorized_keys`,
  );
};

export const removeMachine = (name: string): void => {
  docker(['rm', '-f', '-v', name]);
};
