import { defineComposant } from '@crewdeck/contracts/composants';
import { z } from 'zod';
import { emitAction } from './actions.js';

const Probe = defineComposant({
  name: 'Probe',
  version: 1,
  tag: 'cd-probe',
  category: 'signal',
  description: 'Un Composant de test.',
  data: z.object({}),
  actions: { open: z.object({ id: z.string() }) },
  slots: [],
  examples: [{ name: 'nominal', data: {} }],
});

describe('emitAction', () => {
  it('dispatches a bubbling, composed cd-action with the Composant, the action and the payload', () => {
    const target = new EventTarget();
    const events: CustomEvent[] = [];
    target.addEventListener('cd-action', (event) => events.push(event as CustomEvent));

    emitAction(target, Probe, 'open', { id: '42' });

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.bubbles).toBe(true);
    expect(event?.composed).toBe(true);
    expect(event?.detail).toEqual({ composant: 'Probe', action: 'open', payload: { id: '42' } });
  });
});
