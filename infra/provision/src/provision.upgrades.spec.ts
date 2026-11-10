/** Security updates after provisioning: daily, from the security origins only, never rebooting by themselves. */
import { inject } from 'vitest';
import { must } from './machine.js';

const machine = inject('machine');

describe('unattended-upgrades after provisioning', () => {
  it('runs daily and never reboots by itself', () => {
    const config = must(machine, 'apt-config dump');
    expect(config).toContain('APT::Periodic::Update-Package-Lists "1";');
    expect(config).toContain('APT::Periodic::Unattended-Upgrade "1";');
    expect(config).toContain('Unattended-Upgrade::Automatic-Reboot "false";');
    expect(must(machine, 'systemctl is-enabled apt-daily.timer apt-daily-upgrade.timer').split('\n').filter(Boolean)).toEqual([
      'enabled',
      'enabled',
    ]);
  });

  it('takes only the security origins', () => {
    const origins = must(machine, 'apt-config dump Unattended-Upgrade::Allowed-Origins')
      .split('\n')
      .filter((line) => line.startsWith('Unattended-Upgrade::Allowed-Origins:: '));
    expect(origins).toEqual([
      'Unattended-Upgrade::Allowed-Origins:: "${distro_id}:${distro_codename}-security";',
      'Unattended-Upgrade::Allowed-Origins:: "${distro_id}ESMApps:${distro_codename}-apps-security";',
      'Unattended-Upgrade::Allowed-Origins:: "${distro_id}ESM:${distro_codename}-infra-security";',
    ]);
  });
});
