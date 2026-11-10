/**
 * The firewall after provisioning, seen from `dehors`: ufw lets in 22, 80 and
 * 443 only, and DOCKER-USER keeps a port Docker publishes closed unless it is
 * 80 or 443, Docker restarted or not.
 */
import { inject } from 'vitest';
import { BUSYBOX, HOST, HOST6, lastLine, must, reachable, refusal } from './machine.js';

const machine = inject('machine');

/** Busybox's httpd published on the host's `port`. */
const PUBLISHED = { 'web-test': 80, 'tls-test': 443, 'db-test': 5432 };

beforeAll(() => {
  for (const [name, port] of Object.entries(PUBLISHED)) {
    must(machine, `docker run -d --rm --name ${name} -p ${port}:8080 ${BUSYBOX} httpd -f -p 8080 -h /`);
  }
  must(machine, 'for _ in $(seq 20); do (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null && exit 0; sleep 0.5; done; exit 1');
});

afterAll(() => {
  must(machine, `docker rm -f ${Object.keys(PUBLISHED).join(' ')}`);
});

const expectOnlyWebPortsOpen = (): void => {
  for (const address of [HOST, HOST6]) {
    expect(reachable(machine, address, 80), `${address}:80`).toBe(true);
    expect(reachable(machine, address, 443), `${address}:443`).toBe(true);
    expect(reachable(machine, address, 5432), `${address}:5432`).toBe(false);
  }
};

describe('ufw after provisioning', () => {
  it('denies incoming by default and allows 22, 80, 443 (TCP) and 443/UDP, in IPv4 and IPv6', () => {
    const status = must(machine, 'ufw status verbose');
    expect(status).toContain('Status: active');
    expect(status).toContain('Default: deny (incoming), allow (outgoing)');
    const rules = status
      .split('\n')
      .filter((line) => line.includes('ALLOW IN'))
      .map((line) => line.replace(/\s+/g, ' ').trim());
    expect(rules).toEqual([
      '22/tcp ALLOW IN Anywhere',
      '80/tcp ALLOW IN Anywhere',
      '443/tcp ALLOW IN Anywhere',
      '443/udp ALLOW IN Anywhere',
      '22/tcp (v6) ALLOW IN Anywhere (v6)',
      '80/tcp (v6) ALLOW IN Anywhere (v6)',
      '443/tcp (v6) ALLOW IN Anywhere (v6)',
      '443/udp (v6) ALLOW IN Anywhere (v6)',
    ]);
  });
});

describe('DOCKER-USER after provisioning', () => {
  it('lets 80 and 443 published by Docker in from outside, not 5432', () => {
    expectOnlyWebPortsOpen();
  });

  it('closes 5432 from outside only: the host reaches it', () => {
    expect(must(machine, '(exec 3<>/dev/tcp/127.0.0.1/5432) && echo ouvert').trim()).toBe('ouvert');
  });

  it('is loaded again by crewdeck-docker-user.service when Docker restarts', () => {
    expect(must(machine, 'systemctl is-enabled crewdeck-docker-user.service').trim()).toBe('enabled');
    must(machine, 'iptables -F DOCKER-USER && ip6tables -F DOCKER-USER && systemctl restart docker');
    must(machine, 'for _ in $(seq 20); do (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null && exit 0; sleep 0.5; done; exit 1');
    const chain = must(machine, 'iptables -S DOCKER-USER');
    expect(chain.split('\n').filter((line) => line.includes('--ctstate DNAT -j DROP'))).toHaveLength(1);
    expectOnlyWebPortsOpen();
  });
});

describe('a machine with an ufw rule outside 22, 80 and 443', () => {
  it('is refused, /etc untouched, until the rule is removed', () => {
    const result = refusal(machine, 'ufw allow 8080/tcp', 'ufw delete allow 8080/tcp');
    expect(result.run.status).toBe(1);
    expect(result.run.stderr).toContain('règles ufw hors de 22, 80 et 443');
    expect(result.run.stderr).toContain('allow tcp 8080 0.0.0.0/0 any 0.0.0.0/0 in');
    expect(result.etcAfter).toBe(result.etcBefore);
    expect(lastLine(result.rerun.stdout)).toBe('rien à changer');
  });
});
