import { defineContrat } from './define.js';

/** The technical choices the Inventaire records: the ADRs of the code's Source, numbered. */
const ADRS = 'docs/adr/[0-9][0-9][0-9][0-9]-*.md';

/**
 * The Contrat of the Inventaire (PROJET-4, US-68): what the Rôle Conception
 * drafts from a code base that already exists, on `crewdeck/inventaire`. Its
 * glossary `CONTEXT.md`, one ADR per technical choice the code already made,
 * each with its status line, `docs/inventory.md` listing what exists, and the
 * branch pushed to the clone's origin (the repository or the Local folder).
 */
export const inventoryContrat = defineContrat({
  id: 'inventory',
  version: 1,
  step: 'inventory',
  rules: [
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
  ],
});
