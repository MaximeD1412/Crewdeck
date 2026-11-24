import { CATALOGUE } from '../process/catalogue.js';
import { zContrat } from './define.js';
import { CONTRATS, contratLabel } from './index.js';
import { inventoryContrat } from './inventory.js';

const ADRS = 'docs/adr/[0-9][0-9][0-9][0-9]-*.md';

describe('the Contrat of the Inventaire', () => {
  it('is the catalogue’s Contrat of the kind inventory, version 1, registered for the Runner', () => {
    expect(zContrat.parse(inventoryContrat)).toEqual(inventoryContrat);
    expect(inventoryContrat).toMatchObject({ id: 'inventory', version: 1, step: 'inventory' });
    expect(CATALOGUE.inventory.contrat).toBe('inventory');
    expect(CONTRATS).toContain(inventoryContrat);
  });

  it('asks the glossary, the technical choices with their status, the inventory’s sections and the branch pushed, every rule bloquant', () => {
    expect(inventoryContrat.rules).toEqual([
      { id: 'inventory.glossary.file', label: 'Le glossaire CONTEXT.md existe', severity: 'bloquant', kind: 'file', path: 'CONTEXT.md' },
      {
        id: 'inventory.glossary.terms',
        label: 'Chaque terme du glossaire n’apparaît qu’une fois',
        severity: 'bloquant',
        kind: 'pattern',
        path: 'CONTEXT.md',
        regex: '^\\*\\*([^*]+)\\*\\* \\(',
        unique: true,
        min: 1,
      },
      { id: 'inventory.choices.file', label: 'Au moins un choix technique est écrit', severity: 'bloquant', kind: 'file', glob: ADRS, min: 1 },
      {
        id: 'inventory.choices.status',
        label: 'Chaque choix technique a sa ligne de statut',
        severity: 'bloquant',
        kind: 'check',
        name: 'each-file-has-line',
        params: { glob: ADRS, regex: '^> \\*\\*Status:\\*\\* ' },
      },
      {
        id: 'inventory.list.sections',
        label: 'L’inventaire liste les apps, les écrans, les tests et la CI',
        severity: 'bloquant',
        kind: 'sections',
        path: 'docs/inventory.md',
        headings: ['Apps', 'Routes and screens', 'Tests and CI'],
        level: 2,
      },
      {
        id: 'inventory.branch.pushed',
        label: 'L’inventaire est poussé sur la branche crewdeck/inventaire',
        severity: 'bloquant',
        kind: 'check',
        name: 'branch-pushed',
        params: { branch: 'crewdeck/inventaire' },
      },
    ]);
    expect(contratLabel('inventory', 1, 'inventory.branch.pushed')).toBe('L’inventaire est poussé sur la branche crewdeck/inventaire');
  });

  it('reads a term as the glossary spells it, once per line', () => {
    const term = new RegExp(inventoryContrat.rules.find((rule) => rule.id === 'inventory.glossary.terms')?.regex ?? '');
    expect(term.exec('**Pilote** (`Pilot`):')?.[1]).toBe('Pilote');
    expect(term.test('A **Pilote** (`Pilot`) drives')).toBe(false);
    expect(term.test('**Pilote**: no identifier')).toBe(false);
  });
});
