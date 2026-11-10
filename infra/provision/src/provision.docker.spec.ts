/**
 * Docker after provisioning: Docker CE from Docker's repository, its logs in
 * the `local` driver, the network and the tree the Compose projects expect
 * (infra/deploy/README.md).
 */
import { inject } from 'vitest';
import { ADMIN, lastLine, must, refusal, sh } from './machine.js';

const machine = inject('machine');

describe('Docker after provisioning', () => {
  it('is Docker CE from download.docker.com, not Ubuntu’s docker.io', () => {
    const policy = must(machine, 'apt-cache policy docker-ce');
    expect(policy).not.toMatch(/Installed: \(none\)/);
    expect(policy).toContain('https://download.docker.com/linux/ubuntu noble/stable');
    expect(sh(machine, "dpkg-query -W -f '${db:Status-Status}' docker.io").stdout).not.toBe('installed');
    expect(must(machine, 'docker compose version')).toMatch(/^Docker Compose version v\d+\./);
  });

  it('logs with the local driver and keeps containers through a daemon restart', () => {
    expect(must(machine, "docker info --format '{{.LoggingDriver}} {{.LiveRestoreEnabled}}'").trim()).toBe('local true');
  });

  it('has the network crewdeck-edge', () => {
    expect(must(machine, "docker network inspect --format '{{.Driver}}' crewdeck-edge").trim()).toBe('bridge');
  });

  it('lets the admin use Docker', () => {
    expect(must(machine, `id -nG ${ADMIN}`).split(' ').map((group) => group.trim())).toContain('docker');
  });
});

describe('the tree /opt/crewdeck', () => {
  it('has deploy, prod, staging, edge and backup, mode 750, group docker', () => {
    const tree = must(machine, "stat -c '%n %a %U:%G' /opt/crewdeck /opt/crewdeck/{deploy,prod,staging,edge,backup}");
    expect(tree.trim().split('\n')).toEqual([
      '/opt/crewdeck 750 root:docker',
      '/opt/crewdeck/deploy 750 root:docker',
      '/opt/crewdeck/prod 750 root:docker',
      '/opt/crewdeck/staging 750 root:docker',
      '/opt/crewdeck/edge 750 root:docker',
      '/opt/crewdeck/backup 750 root:docker',
    ]);
  });
});

describe('a Docker whose published ports would bypass DOCKER-USER', () => {
  it('is refused, /etc untouched, with the nftables firewall backend', () => {
    const result = refusal(
      machine,
      `cp -p /etc/docker/daemon.json /root/essai/daemon.json
       jq '. + {"firewall-backend": "nftables"}' /root/essai/daemon.json > /etc/docker/daemon.json`,
      'cp -p /root/essai/daemon.json /etc/docker/daemon.json',
    );
    expect(result.run.status).toBe(1);
    expect(result.run.stderr).toContain('firewall-backend nftables');
    expect(result.etcAfter).toBe(result.etcBefore);
    expect(lastLine(result.rerun.stdout)).toBe('rien à changer');
  });
});
