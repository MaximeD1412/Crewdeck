/**
 * SSH after provisioning, seen from `dehors`: the admin's key only, no
 * password, no root; fail2ban bans after five failures; and a machine whose
 * sshd configuration would defeat the hardening is refused untouched.
 */
import { inject } from 'vitest';
import { ADMIN, HOST, INTRUDER, KEY, lastLine, lines, must, refusal, sh, sshFromOutside } from './machine.js';

const machine = inject('machine');

describe('SSH after provisioning', () => {
  it('accepts the admin with their key', () => {
    const result = sshFromOutside(machine, `-i ${KEY} ${ADMIN}@${HOST}`);
    expect(result.stderr).not.toContain('Permission denied');
    expect(result.status).toBe(0);
  });

  it('refuses a password: only the public key is offered', () => {
    const result = sshFromOutside(machine, `-o PubkeyAuthentication=no ${ADMIN}@${HOST}`);
    expect(result.status).toBe(255);
    expect(result.stderr).toContain('Permission denied (publickey)');
  });

  it('refuses root, even with a key root holds', () => {
    expect(must(machine, 'cat /root/.ssh/authorized_keys')).toContain(must(machine, `cat ${KEY}.pub`).trim());
    const result = sshFromOutside(machine, `-i ${KEY} root@${HOST}`);
    expect(result.status).toBe(255);
    expect(result.stderr).toContain('Permission denied');
  });

  it('runs with the hardened configuration, AllowUsers naming the admin and deploy', () => {
    const effective = lines(must(machine, 'sshd -T'));
    expect(effective).toEqual(
      expect.arrayContaining([
        'passwordauthentication no',
        'kbdinteractiveauthentication no',
        'permitrootlogin no',
        `allowusers ${ADMIN}`,
        'allowusers deploy',
      ]),
    );
  });

  it('gives the admin sudo without a password', () => {
    expect(sh(machine, `sudo -u ${ADMIN} sudo -n true`).status).toBe(0);
  });
});

describe('fail2ban', () => {
  it('watches sshd: 5 tries, banned 1 h', () => {
    expect(must(machine, 'fail2ban-client get sshd maxretry').trim()).toBe('5');
    expect(must(machine, 'fail2ban-client get sshd bantime').trim()).toBe('3600');
  });

  it('bans an address after repeated failures, not the admin', () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      sshFromOutside(machine, `-b ${INTRUDER} -o PubkeyAuthentication=no intrus@${HOST}`);
    }
    must(
      machine,
      `for _ in $(seq 20); do fail2ban-client status sshd | grep -q ${INTRUDER} && exit 0; sleep 1; done
       fail2ban-client status sshd >&2; exit 1`,
    );
    expect(sshFromOutside(machine, `-i ${KEY} ${ADMIN}@${HOST}`).status).toBe(0);
  });
});

describe('a machine whose sshd configuration would defeat the hardening', () => {
  it('is refused, /etc untouched, while a Match block lets root in', () => {
    const conf = '/etc/ssh/sshd_config.d/60-exception.conf';
    const result = refusal(
      machine,
      `printf 'Match Address 203.0.113.0/24\\nPermitRootLogin=yes\\n' > ${conf}`,
      `rm ${conf}`,
    );
    expect(result.run.status).toBe(1);
    expect(result.run.stderr).toContain(`${conf}: PermitRootLogin=yes (bloc Match)`);
    expect(result.etcAfter).toBe(result.etcBefore);
    expect(lastLine(result.rerun.stdout)).toBe('rien à changer');
  });

  it('is refused, /etc untouched, while sshd listens on another port than 22', () => {
    const conf = '/etc/ssh/sshd_config.d/10-port.conf';
    const result = refusal(machine, `echo 'Port 2222' > ${conf}`, `rm ${conf}`);
    expect(result.run.status).toBe(1);
    expect(result.run.stderr).toContain("sshd n'écoute pas sur le port 22");
    expect(result.run.stderr).toContain('listenaddress 0.0.0.0:2222');
    expect(result.etcAfter).toBe(result.etcBefore);
    expect(lastLine(result.rerun.stdout)).toBe('rien à changer');
  });
});
