import { defineContrat } from '../../src/contrats/define.js';

/**
 * The example Contrat, for the tests only: one rule of each kind (two for
 * `file`, its path and its glob), one of them `attention`. `contracts:generate`
 * writes it to `example.json` here and embeds it in the Runner for
 * `crewdeck-runner contrat check example`. `example/pass/` passes it;
 * `example/fail-<rule-id>/` fails exactly that rule; `example/pr.json` is a PR
 * that passes `example.pr`.
 */
export const exampleContrat = defineContrat({
  id: 'example',
  version: 1,
  step: 'code',
  rules: [
    { id: 'example.readme', label: 'Le README est présent', severity: 'bloquant', kind: 'file', path: 'README.md' },
    { id: 'example.notes', label: 'Au moins deux notes dans docs/notes/', severity: 'bloquant', kind: 'file', glob: 'docs/notes/*.md', min: 2 },
    { id: 'example.changelog', label: 'Le CHANGELOG est présent', severity: 'attention', kind: 'file', path: 'CHANGELOG.md' },
    {
      id: 'example.prd.sections',
      label: 'Le PRD a ses sections, dans l’ordre',
      severity: 'bloquant',
      kind: 'sections',
      path: 'docs/prd.md',
      headings: ['Problème', 'Solution', 'Stories'],
      level: 2,
    },
    {
      id: 'example.stories.unique',
      label: 'Chaque story a un identifiant unique',
      severity: 'bloquant',
      kind: 'pattern',
      path: 'docs/prd.md',
      regex: '^- \\*\\*US-(\\d+)\\*\\* ',
      unique: true,
      min: 2,
    },
    {
      id: 'example.tickets.front-matter',
      label: 'Chaque ticket a son identifiant et son titre',
      severity: 'bloquant',
      kind: 'front-matter',
      glob: 'backlog/**/*.md',
      schema: {
        type: 'object',
        required: ['id', 'title'],
        properties: { id: { type: 'string', pattern: '^T-[0-9]+$' }, title: { type: 'string', minLength: 1 }, size: { enum: ['S', 'M', 'L'] } },
      },
    },
    {
      id: 'example.screens.json',
      label: 'design/screens.json est valide',
      severity: 'bloquant',
      kind: 'json',
      path: 'design/screens.json',
      schema: {
        type: 'array',
        minItems: 1,
        items: { type: 'object', required: ['id', 'widths'], properties: { id: { type: 'string' }, widths: { type: 'array', items: { enum: [390, 1280] } } } },
      },
    },
    {
      id: 'example.pr',
      label: 'La PR va vers la branche d’intégration, ferme son ticket et porte le label',
      severity: 'bloquant',
      kind: 'pr',
      base: 'integration',
      branch: '^(feat|fix|chore)/[0-9]+-[a-z0-9-]+$',
      body: ['^Closes #[0-9]+$'],
      labels: ['conception'],
    },
    {
      id: 'example.src.nonempty',
      label: 'Le dossier src/ n’est pas vide',
      severity: 'bloquant',
      kind: 'check',
      name: 'example-nonempty-dir',
      params: { path: 'src' },
    },
  ],
});
