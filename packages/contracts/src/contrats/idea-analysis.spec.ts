import { CATALOGUE } from '../process/catalogue.js';
import { zContrat } from './define.js';
import { IDEA_ANALYSIS_CONTRAT, IDEA_ANALYSIS_REPORT_PATH } from './idea-analysis.js';
import { CONTRATS, contratLabel } from './index.js';

describe('the Contrat of idea-analysis', () => {
  it('is the current Contrat the catalogue names for the kind', () => {
    expect(CATALOGUE['idea-analysis'].contrat).toBe('idea-analysis');
    expect(CONTRATS.find((contrat) => contrat.id === 'idea-analysis')).toBe(IDEA_ANALYSIS_CONTRAT);
    expect(zContrat.parse(IDEA_ANALYSIS_CONTRAT)).toMatchObject({ id: 'idea-analysis', version: 1, step: 'idea-analysis' });
  });

  it('has its four rules, all bloquant, with their French labels', () => {
    expect(IDEA_ANALYSIS_CONTRAT.rules.map((rule) => [rule.id, rule.severity, rule.label])).toEqual([
      ['idea-analysis.report.schema', 'bloquant', 'Le rapport a un titre et un résumé d’au plus 400 caractères'],
      ['idea-analysis.report.figures', 'bloquant', 'L’impact et l’effort vont de 1 à 5, chacun avec sa raison'],
      ['idea-analysis.report.project', 'bloquant', 'Le Projet visé est un de tes Projets ou « nouveau »'],
      ['idea-analysis.report.duplicates', 'bloquant', 'Les doublons sont des Idées ouvertes'],
    ]);
    expect(contratLabel('idea-analysis', 1, 'idea-analysis.report.duplicates')).toBe('Les doublons sont des Idées ouvertes');
  });

  it('reads the report the Skill writes, a summary of 400 characters at most', () => {
    const [schema, figures, project, duplicates] = IDEA_ANALYSIS_CONTRAT.rules;
    expect(schema).toMatchObject({ kind: 'json', path: IDEA_ANALYSIS_REPORT_PATH, schema: { properties: { summary: { maxLength: 400 }, title: { maxLength: 80 } } } });
    expect(figures).toMatchObject({ kind: 'json', schema: { properties: { impact: { minimum: 1, maximum: 5 }, effort: { minimum: 1, maximum: 5 } } } });
    expect(project).toMatchObject({ kind: 'check', name: 'idea-project' });
    expect(duplicates).toMatchObject({ kind: 'check', name: 'idea-duplicates' });
  });
});
