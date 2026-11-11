import { currentPilotId } from '../scope/scope.context.js';
import { parseRunnerMessage, type RunnerContext, RunnerDispatcher } from './runner-dispatcher.js';

const ID = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01';
const AT = '2026-11-11T08:00:00.000Z';
const context = (reply = vi.fn()): RunnerContext => ({ pilotId: 'pilot-1', runnerId: 'runner-1', reply });

describe('parseRunnerMessage', () => {
  it('reads a message of RunnerToServer', () => {
    expect(parseRunnerMessage(JSON.stringify({ type: 'heartbeat', id: ID, at: AT }))).toEqual({ type: 'heartbeat', id: ID, at: AT });
  });

  it.each([
    ['not JSON', 'not json'],
    ['a type outside the protocol', JSON.stringify({ type: 'relay', id: ID, at: AT, payload: 'x' })],
    ['a message without its envelope', JSON.stringify({ type: 'heartbeat' })],
    ['a message of the server', JSON.stringify({ type: 'heartbeat.ack', id: ID, at: AT })],
  ])('refuses %s', (_, text) => {
    expect(parseRunnerMessage(text)).toBeUndefined();
  });
});

describe('RunnerDispatcher', () => {
  it('runs the handler of the message’s type, in its Pilote’s scope', async () => {
    const dispatcher = new RunnerDispatcher();
    const seen: string[] = [];
    dispatcher.registerRunnerHandler('heartbeat', (message, { reply }) => {
      seen.push(`${message.type} for ${currentPilotId()}`);
      reply({ type: 'heartbeat.ack' });
    });
    const reply = vi.fn();

    expect(await dispatcher.dispatch({ type: 'heartbeat', id: ID, at: AT }, context(reply))).toBe(true);

    expect(seen).toEqual(['heartbeat for pilot-1']);
    expect(reply).toHaveBeenCalledWith({ type: 'heartbeat.ack' });
  });

  it('says when a type has no handler', async () => {
    expect(await new RunnerDispatcher().dispatch({ type: 'heartbeat', id: ID, at: AT }, context())).toBe(false);
  });

  it('refuses a second handler of the same type', () => {
    const dispatcher = new RunnerDispatcher();
    dispatcher.registerRunnerHandler('heartbeat', () => undefined);

    expect(() => dispatcher.registerRunnerHandler('heartbeat', () => undefined)).toThrow(/already registered/);
  });
});
