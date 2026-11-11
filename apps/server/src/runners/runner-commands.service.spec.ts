import type { Mock } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { RunnerCommands } from './runner-commands.service.js';
import { type RunnerLink, RunnerConnections, stamp } from './runner-connections.js';
import type { RunnerPresence } from './runner-presence.service.js';

const link = (pilotId: string): RunnerLink & { send: Mock<RunnerLink['send']>; close: Mock<RunnerLink['close']> } => ({
  pilotId,
  runnerId: `${pilotId}-runner`,
  send: vi.fn<RunnerLink['send']>(),
  close: vi.fn<RunnerLink['close']>(),
});

const presence = (online: boolean): RunnerPresence => ({ isOnline: () => online }) as unknown as RunnerPresence;

describe('RunnerConnections', () => {
  it('keeps one socket per Pilote: a newer one takes the place of the one before, which it returns', () => {
    const connections = new RunnerConnections();
    const first = link('alice');
    const second = { ...link('alice') };

    expect(connections.take(first)).toBeUndefined();
    expect(connections.take(second)).toBe(first);
    expect(connections.of('alice')).toBe(second);
    expect(connections.release(first)).toBe(false);
    expect(connections.release(second)).toBe(true);
    expect(connections.of('alice')).toBeUndefined();
  });
});

describe('stamp', () => {
  it('gives a message its id and at', () => {
    expect(stamp({ type: 'heartbeat.ack' })).toEqual({ type: 'heartbeat.ack', id: expect.any(String), at: expect.any(String) });
  });

  it('throws on a message outside ServerToRunner', () => {
    expect(() => stamp({ type: 'hello.rejected', reason: 'nope' } as never)).toThrow();
  });
});

describe('RunnerCommands.send', () => {
  it('sends the stamped message to the Pilote’s Runner', () => {
    const connections = new RunnerConnections();
    const alice = link('alice');
    connections.take(alice);

    new RunnerCommands(connections, presence(true)).send('alice', { type: 'heartbeat.ack' });

    expect(alice.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'heartbeat.ack', id: expect.any(String) }));
  });

  it.each([
    ['no socket', false, true],
    ['a socket of a Runner swept offline', true, false],
  ])('throws runner.offline (422) with %s', (_, connected, online) => {
    const connections = new RunnerConnections();
    if (connected) connections.take(link('alice'));
    const send = (): void => new RunnerCommands(connections, presence(online)).send('alice', { type: 'heartbeat.ack' });

    expect(send).toThrow(AppError);
    expect(send).toThrow(expect.objectContaining({ status: 422, code: 'runner.offline', message: 'Le Runner est hors ligne.' }));
  });

  it('never sends to another Pilote’s Runner', () => {
    const connections = new RunnerConnections();
    const bob = link('bob');
    connections.take(bob);

    expect(() => new RunnerCommands(connections, presence(true)).send('alice', { type: 'heartbeat.ack' })).toThrow(expect.objectContaining({ code: 'runner.offline' }));
    expect(bob.send).not.toHaveBeenCalled();
  });
});
