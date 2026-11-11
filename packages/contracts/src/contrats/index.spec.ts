import { defineContrat } from './define.js';
import { CONTRATS, contratLabel, contratRegistry, CONTRAT_HISTORY } from './index.js';

const v1 = defineContrat({
  id: 'prd',
  version: 1,
  step: 'prd',
  rules: [
    { id: 'prd.context', label: 'CONTEXT.md est présent', severity: 'bloquant', kind: 'file', path: 'CONTEXT.md' },
    { id: 'prd.old', label: 'Une règle retirée depuis', severity: 'attention', kind: 'file', path: 'OLD.md' },
  ],
});
const v2 = defineContrat({
  id: 'prd',
  version: 2,
  step: 'prd',
  rules: [{ id: 'prd.context', label: 'Le glossaire CONTEXT.md est présent', severity: 'bloquant', kind: 'file', path: 'CONTEXT.md' }],
});

describe('contratRegistry', () => {
  const registry = contratRegistry([v2], [v1]);

  it('gives the label of a rule of a past version, as that version wrote it', () => {
    expect(registry.label('prd', 1, 'prd.old')).toBe('Une règle retirée depuis');
    expect(registry.label('prd', 1, 'prd.context')).toBe('CONTEXT.md est présent');
    expect(registry.label('prd', 2, 'prd.context')).toBe('Le glossaire CONTEXT.md est présent');
  });

  it('gives no label for an unknown Contrat, version or rule', () => {
    expect(registry.label('mockups', 1, 'prd.context')).toBeUndefined();
    expect(registry.label('prd', 3, 'prd.context')).toBeUndefined();
    expect(registry.label('prd', 2, 'prd.old')).toBeUndefined();
  });

  it('finds the current version of each Contrat', () => {
    expect(registry.current('prd')).toBe(v2);
    expect(registry.current('mockups')).toBeUndefined();
  });

  it('refuses a version declared twice, or a past version not below the current one', () => {
    expect(() => contratRegistry([v2], [v2])).toThrow(/prd v2/);
    expect(() => contratRegistry([v1], [v2])).toThrow(/prd v2/);
    expect(() => contratRegistry([v1, v2], [])).toThrow(/prd/);
  });
});

describe('the registry of the Étapes’ Contrats', () => {
  it('holds valid declarations, each past version below its current one', () => {
    expect(() => contratRegistry(CONTRATS, CONTRAT_HISTORY)).not.toThrow();
  });

  it('answers contratLabel from every declared version', () => {
    for (const contrat of [...CONTRATS, ...CONTRAT_HISTORY]) {
      for (const rule of contrat.rules) expect(contratLabel(contrat.id, contrat.version, rule.id)).toBe(rule.label);
    }
    expect(contratLabel('example', 1, 'example.readme')).toBeUndefined();
  });
});
