import { defineContrat } from './define.js';

/** Where the Skill of `idea-analysis` writes its report, in its scratch directory (IDEE-2). */
export const IDEA_ANALYSIS_REPORT_PATH = '.crewdeck/report.json';

/** Where the Runner writes what the Skill reads: the Idée, the Projets, the open Idées and Tickets. */
export const IDEA_ANALYSIS_CONTEXT_PATH = '.crewdeck/context.json';

/** The `projectId` of a report that proposes a new Projet. */
export const IDEA_ANALYSIS_NEW_PROJECT = 'nouveau';

/** The bounds of a report, which the Contrat's schemas and the sealed content share. */
export const IDEA_ANALYSIS_LIMITS = {
  title: 80,
  summary: 400,
  why: 400,
  duplicates: 5,
  questions: 3,
  question: 300,
} as const;

const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });

/**
 * The Contrat of the analysis of an Idée (ADR 0005's first row, US-48),
 * checked by the Runner on the scratch directory of its Session before the
 * report leaves it, and again at the Session's end. Its JSON rules read the
 * report's shape; its two checks read the report against the context the
 * Runner wrote (`idea-project`, `idea-duplicates` in
 * `apps/runner/internal/contrat/checks/`).
 */
export const IDEA_ANALYSIS_CONTRAT = defineContrat({
  id: 'idea-analysis',
  version: 1,
  step: 'idea-analysis',
  rules: [
    {
      id: 'idea-analysis.report.schema',
      label: 'Le rapport a un titre et un résumé d’au plus 400 caractères',
      severity: 'bloquant',
      kind: 'json',
      path: IDEA_ANALYSIS_REPORT_PATH,
      schema: {
        type: 'object',
        required: ['title', 'summary', 'projectId', 'projectWhy', 'duplicates', 'questions'],
        properties: {
          title: text(IDEA_ANALYSIS_LIMITS.title),
          summary: text(IDEA_ANALYSIS_LIMITS.summary),
          projectId: { type: 'string', minLength: 1, maxLength: 60 },
          projectWhy: text(IDEA_ANALYSIS_LIMITS.why),
          duplicates: {
            type: 'array',
            maxItems: IDEA_ANALYSIS_LIMITS.duplicates,
            items: {
              type: 'object',
              required: ['id', 'why'],
              properties: { id: { type: 'string', minLength: 1, maxLength: 60 }, why: text(IDEA_ANALYSIS_LIMITS.why) },
              additionalProperties: false,
            },
          },
          questions: { type: 'array', maxItems: IDEA_ANALYSIS_LIMITS.questions, items: text(IDEA_ANALYSIS_LIMITS.question) },
        },
      },
    },
    {
      id: 'idea-analysis.report.figures',
      label: 'L’impact et l’effort vont de 1 à 5, chacun avec sa raison',
      severity: 'bloquant',
      kind: 'json',
      path: IDEA_ANALYSIS_REPORT_PATH,
      schema: {
        type: 'object',
        required: ['impact', 'impactWhy', 'effort', 'effortWhy'],
        properties: {
          impact: { type: 'integer', minimum: 1, maximum: 5 },
          impactWhy: text(IDEA_ANALYSIS_LIMITS.why),
          effort: { type: 'integer', minimum: 1, maximum: 5 },
          effortWhy: text(IDEA_ANALYSIS_LIMITS.why),
        },
      },
    },
    {
      id: 'idea-analysis.report.project',
      label: 'Le Projet visé est un de tes Projets ou « nouveau »',
      severity: 'bloquant',
      kind: 'check',
      name: 'idea-project',
      params: { report: IDEA_ANALYSIS_REPORT_PATH, context: IDEA_ANALYSIS_CONTEXT_PATH },
    },
    {
      id: 'idea-analysis.report.duplicates',
      label: 'Les doublons sont des Idées ouvertes',
      severity: 'bloquant',
      kind: 'check',
      name: 'idea-duplicates',
      params: { report: IDEA_ANALYSIS_REPORT_PATH, context: IDEA_ANALYSIS_CONTEXT_PATH },
    },
  ],
});
