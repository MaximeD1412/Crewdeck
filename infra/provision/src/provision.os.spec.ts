/** The script refuses any other release than Ubuntu 24.04 before touching anything. */
import { docker, ETC_STATE, SCRIPT } from './machine.js';

const RELEASE = 'ubuntu:22.04';

describe('provision.sh on another release', () => {
  // Pulled first when missing: `docker run` would write its download on the
  // stderr checked here.
  beforeAll(() => {
    if (docker(['image', 'inspect', RELEASE]).status === 0) return;
    const pull = docker(['pull', '-q', RELEASE]);
    if (pull.status !== 0) throw new Error(`docker pull ${RELEASE} : ${pull.stderr}`);
  });

  it('stops at once on Ubuntu 22.04 with « Ubuntu 24.04 attendu », /etc untouched', () => {
    const result = docker([
      'run', '--rm', '-v', `${SCRIPT}:/src/provision.sh:ro`, RELEASE,
      'bash', '-c',
      `{ ${ETC_STATE}
       } > /tmp/avant
       code=0; bash /src/provision.sh --admin-user ops --admin-key /dev/null || code=$?
       { ${ETC_STATE}
       } > /tmp/apres
       diff /tmp/avant /tmp/apres >&2 || exit 99
       exit $code`,
    ]);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^provision: Ubuntu 24\.04 attendu \(trouvé : Ubuntu 22\.04[^)]*\)\n$/);
    expect(result.status).toBe(1);
  });
});
