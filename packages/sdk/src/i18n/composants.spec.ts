import { COMPOSANTS, defineComposant } from '@crewdeck/contracts/composants';
import { z } from 'zod';
import { composantKeys, missingComposantKeys } from './composants.js';
import { fr } from './fr.js';

const Probe = defineComposant({
  name: 'Probe',
  version: 1,
  tag: 'cd-probe',
  category: 'signal',
  description: 'Un Composant de test.',
  data: z.object({ title: z.string(), tone: z.string().optional() }),
  actions: { open: z.object({ id: z.string() }) },
  slots: ['actions'],
  examples: [{ name: 'nominal', data: { title: 'x' } }],
});

describe('the t() keys of a Composant', () => {
  it('are its description, one per field of its data, per Emplacement and per action', () => {
    expect(composantKeys(Probe)).toEqual({
      description: 'composants.Probe.description',
      data: { title: 'composants.Probe.data.title', tone: 'composants.Probe.data.tone' },
      slots: { actions: 'composants.Probe.slots.actions' },
      actions: { open: 'composants.Probe.actions.open' },
    });
  });

  it('are reported when the catalogue lacks them', () => {
    expect(missingComposantKeys(Probe, { 'composants.Probe.description': 'Un Composant de test.' })).toEqual([
      'composants.Probe.data.title',
      'composants.Probe.data.tone',
      'composants.Probe.slots.actions',
      'composants.Probe.actions.open',
    ]);
  });

  it.each(Object.values(COMPOSANTS).map((declaration) => [declaration.name, declaration] as const))(
    'are all in fr.ts for %s',
    (_name, declaration) => {
      expect(missingComposantKeys(declaration, fr)).toEqual([]);
    },
  );
});
