import { z } from 'zod';
import { zSensitiveActionId } from '../api/sensitive-actions.js';
import { defineComposant } from './define.js';
import { actionSchema, sensitive, sensitiveActionOf } from './sensitive.js';

const Probe = defineComposant({
  name: 'Probe',
  version: 1,
  tag: 'cd-probe',
  category: 'partie',
  description: 'Une sonde.',
  data: z.object({}),
  actions: { open: z.object({ id: z.string() }), approve: sensitive('document.approve', z.object({ id: z.string() })) },
  slots: [],
  examples: [{ name: 'nominal', data: {} }],
});

describe('zSensitiveActionId', () => {
  it('names the six Actions sensibles, nothing else', () => {
    expect(zSensitiveActionId.options).toEqual([
      'merge',
      'loop.start',
      'schedule.create',
      'schedule.resume',
      'document.approve',
      'inventory.approve',
    ]);
    expect(zSensitiveActionId.safeParse('loop.stop').success).toBe(false);
  });
});

describe('sensitive', () => {
  it('keeps the schema and the Action sensible it is', () => {
    const schema = z.object({ id: z.string() });
    expect(sensitive('merge', schema)).toEqual({ schema, sensitive: 'merge' });
    expect(Object.isFrozen(sensitive('merge', schema))).toBe(true);
  });

  it('refuses an id that is not an Action sensible', () => {
    expect(() => sensitive('loop.stop' as never, z.object({}))).toThrow(/loop\.stop/);
  });

  it('reads, for any declared action, its payload schema and whether it is sensitive', () => {
    expect(sensitiveActionOf(Probe.actions.approve)).toBe('document.approve');
    expect(sensitiveActionOf(Probe.actions.open)).toBeNull();
    expect(actionSchema(Probe.actions.approve).parse({ id: '1' })).toEqual({ id: '1' });
    expect(actionSchema(Probe.actions.open).safeParse({ id: 1 }).success).toBe(false);
  });
});
