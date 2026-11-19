import { CATALOGUE, PROCESS_CREWDECK, type StepKindSpec } from '@crewdeck/contracts';
import { catalogueMenu } from './catalogue-menu.js';

const item = (menu: ReturnType<typeof catalogueMenu>, id: string) => menu.groups.flatMap((group) => group.items).find((candidate) => candidate.id === id);

describe('catalogueMenu', () => {
  const menu = catalogueMenu(PROCESS_CREWDECK, 'Développement');

  it('is titled with the Phase it adds to', () => {
    expect(menu.title).toBe('Ajouter dans « Développement »');
  });

  it('has one group per menu of the catalogue, in its order, each kind in the catalogue’s order', () => {
    expect(menu.groups.map((group) => group.label)).toEqual(['Étapes du Modèle de process « Process Crewdeck »', 'Revues', 'Sur ton Runner']);
    expect(menu.groups.map((group) => group.items.map((entry) => entry.label))).toEqual([
      ['Analyse de l’Idée', 'Inventaire', 'PRD', 'Maquettes', 'Conception technique', 'Découpage en Tickets', 'Code', 'Tri de l’Idée', 'Approbation'],
      ['Revue croisée', 'Review', 'Revue visuelle'],
      ['Commande'],
    ]);
  });

  it('never lists the Checks nor the Merge', () => {
    expect(item(menu, 'checks')).toBeUndefined();
    expect(item(menu, 'merge')).toBeUndefined();
  });

  it('gives each item its family’s icon and its ports as detail', () => {
    expect(item(menu, 'idea-analysis')).toEqual({ id: 'idea-analysis', label: 'Analyse de l’Idée', icon: 'spark', detail: 'Idée → Idée', selected: false, disabled: false });
    expect(item(menu, 'inventory')?.detail).toBe('→ Inventaire');
    expect(item(menu, 'technical-design')?.detail).toBe('PRD, Maquettes → Conception technique');
    expect(item(menu, 'split')?.detail).toBe('… → Ticket');
    expect(item(menu, 'cross-review')?.detail).toBe('… → Verdict');
    expect(item(menu, 'visual-review')).toMatchObject({ icon: 'user', detail: 'Changement de code, Maquettes → Verdict' });
    expect(item(menu, 'idea-triage')?.icon).toBe('user');
  });

  it('says the Review is on the Rôle of one’s choice, the Commande judged on its exit code', () => {
    expect(item(menu, 'review')).toMatchObject({ icon: 'spark', detail: 'sur le Rôle de ton choix → Verdict' });
    expect(item(menu, 'command')).toMatchObject({ icon: 'terminal', detail: 'jugée sur son code de sortie' });
  });

  it('disables a unique kind the definition already holds', () => {
    const catalogue = { ...CATALOGUE, 'visual-review': { ...CATALOGUE['visual-review'], unique: true } satisfies StepKindSpec };
    expect(item(catalogueMenu(PROCESS_CREWDECK, 'Développement', catalogue), 'visual-review')?.disabled).toBe(true);
    expect(item(catalogueMenu({ ...PROCESS_CREWDECK, steps: PROCESS_CREWDECK.steps.filter((step) => step.kind !== 'visual-review') }, 'Développement', catalogue), 'visual-review')?.disabled).toBe(false);
    expect(item(menu, 'visual-review')?.disabled).toBe(false);
  });
});
