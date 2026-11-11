import { safeError } from './safe-error.js';

const PRIVATE = 'Description privée\n    at private-client-secret\n    at fake (/srv/app/fake.js:1:2)';

describe('safeError, what a log shows of a webhook handler’s error', () => {
  it('keeps the class, a short code and the frames', () => {
    const error = Object.assign(new TypeError('boom'), { code: 'P2002' });

    const safe = safeError(error);

    expect(safe).toMatchObject({ type: 'TypeError', code: 'P2002' });
    expect(safe.stack).toMatch(/^ {4}at .*safe-error\.spec\.ts/);
  });

  it('keeps the frames of a class that names itself after super(), as Prisma’s errors do', () => {
    class LateNamed extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'LateNamed';
      }
    }

    const safe = safeError(new LateNamed(`failed on ${PRIVATE}`));

    expect(safe.type).toBe('LateNamed');
    expect(safe.stack).toContain('safe-error.spec.ts');
    expect(JSON.stringify(safe)).not.toContain('private');
  });

  it('drops a multi-line message entirely, even its lines that look like frames', () => {
    const safe = safeError(new Error(`cannot read ${PRIVATE}`));

    expect(JSON.stringify(safe)).not.toContain('private');
    expect(JSON.stringify(safe)).not.toContain('Description');
    expect(JSON.stringify(safe)).not.toContain('fake.js');
    expect(safe.stack).toContain('safe-error.spec.ts');
  });

  it('drops the stack when it no longer starts with the message: it was rewritten, its frames cannot be told apart', () => {
    const error = new Error('first');
    error.stack = `Error: other\n    at ${PRIVATE}`;
    const renamed = new Error('before');
    renamed.message = `after ${PRIVATE}`;

    expect(safeError(error)).toEqual({ type: 'Error' });
    expect(JSON.stringify(safeError(renamed))).not.toContain('private');
  });

  it('drops the properties and a code that is not short', () => {
    const error = Object.assign(new Error('x'), { details: { body: 'private-body' }, code: 'a code with spaces' });

    expect(JSON.stringify(safeError(error))).not.toContain('private-body');
    expect(safeError(error)).not.toHaveProperty('code');
    expect(safeError('a string thrown')).toEqual({ type: 'string' });
  });
});
