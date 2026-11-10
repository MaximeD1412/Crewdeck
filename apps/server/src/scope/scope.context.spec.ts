import { currentPilotId, runInPilotScope, ScopeMissingError } from './scope.context.js';

/** A thenable that reads the scope only once awaited, as a PrismaPromise runs its query. */
const deferred = (): PromiseLike<string> => ({
  then: (onfulfilled, onrejected) => new Promise<string>((resolve) => resolve(currentPilotId())).then(onfulfilled, onrejected),
});

describe('runInPilotScope', () => {
  it('runs a deferred query, awaited by the caller, inside the scope', async () => {
    await expect(runInPilotScope('p1', () => deferred())).resolves.toBe('p1');
  });

  it('keeps the scope across the callback’s awaits', async () => {
    const pilotId = await runInPilotScope('p1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentPilotId();
    });

    expect(pilotId).toBe('p1');
  });

  it('closes the scope once the callback is done', async () => {
    await runInPilotScope('p1', () => deferred());

    expect(() => currentPilotId()).toThrow(ScopeMissingError);
    await expect(Promise.resolve(deferred())).rejects.toBeInstanceOf(ScopeMissingError);
  });

  it('passes on what the callback throws', async () => {
    await expect(
      runInPilotScope('p1', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
