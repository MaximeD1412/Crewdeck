import { ideaItemAad, type IdeaAnalysisContent, type IdeaAnalysisRun } from '@crewdeck/contracts';
import { ideaStateRow } from '../../ideas/idea.view.js';
import { newId } from '../../ids.js';
import { sealItem } from '../vault.js';
import { defineScenario, type ScenarioContext } from './define.js';
import { MOCKUP, seedIdeas, seedProjects, seedTrustedDevice } from './idees.js';
import { signInPilot } from './sign-in.js';

const MINUTE = 60_000;

/** An analysis the scenario seals as the Runner's report would leave it, and its figures. */
interface SeededAnalysis {
  readonly number: number;
  /** The Projet visé by its name, `null` for « nouveau ». */
  readonly target: string | null;
  readonly impact: number;
  readonly effort: number;
  /** The numbers of its possible duplicates. */
  readonly duplicates: readonly number[];
  readonly content: (ids: ReadonlyMap<number, string>) => IdeaAnalysisContent;
  /** How long ago it ran, in minutes. */
  readonly age: number;
}

/** #63 of `design/screens/crewdeck/idee.html`: in Personal OS, impact moyen, effort faible, #58 a possible duplicate. */
const EXPORT_PDF: SeededAnalysis = {
  number: 63,
  target: 'Personal OS',
  impact: 3,
  effort: 2,
  duplicates: [58],
  age: 115,
  content: (ids) => ({
    title: 'Exporter le planning en PDF pour le client',
    summary: 'Un bouton dans le planning de Personal OS qui produit la semaine affichée en PDF, prêt à envoyer au client.',
    projectWhy: 'Le planning est dans Personal OS',
    impactWhy: 'le client le demande à chaque fin de semaine',
    effortWhy: 'le planning existe déjà, seul l’export manque',
    duplicates: [{ id: ids.get(58) ?? newId(), why: 'Le même planning de la semaine, imprimé plutôt qu’envoyé' }],
    questions: [],
  }),
};

/** #61 and #62 of `idees-analyse-echouee.html`, analysed beside the failed #64. */
const OTHERS: readonly SeededAnalysis[] = [
  {
    number: 62,
    target: 'Site mairie',
    impact: 2,
    effort: 1,
    duplicates: [],
    age: 24 * 60,
    content: () => ({
      title: 'Corriger la date des actualités sur le téléphone',
      summary: 'La date des actualités s’affiche en anglais sur le téléphone.',
      projectWhy: 'Les actualités sont celles du site de la mairie',
      impactWhy: 'seule la date est en cause',
      effortWhy: 'le format de la date suffit',
      duplicates: [],
      questions: [],
    }),
  },
  {
    number: 61,
    target: 'Personal OS',
    impact: 3,
    effort: 3,
    duplicates: [],
    age: 3 * 24 * 60 - 10,
    content: () => ({
      title: 'Chercher dans les recettes par ingrédient',
      summary: 'Une recherche des recettes qui contiennent un ingrédient donné.',
      projectWhy: 'Les recettes sont dans Personal OS',
      impactWhy: 'la recherche sert chaque semaine',
      effortWhy: 'les ingrédients ne sont pas encore indexés',
      duplicates: [],
      questions: [],
    }),
  },
];

/** The last run of an Idée's `idea-analysis` Étape as the server leaves it (`IdeaAnalysisRun`): Rôle Idée, Claude Code. */
const analysisRun = (status: IdeaAnalysisRun['status'], at: Date, failedRuleIds: readonly string[] = []): IdeaAnalysisRun => ({
  stepRunId: newId(),
  status,
  role: 'idea',
  engine: 'claude-code',
  at: at.toISOString(),
  contractId: 'idea-analysis',
  contractVersion: 1,
  failedRuleIds: [...failedRuleIds],
});

/** The mockup's Idées (`seedIdees`), then their ids by number. */
const seedMockup = async (ctx: ScenarioContext) => {
  const seed = await signInPilot(ctx);
  const projects = await seedProjects(ctx, seed.pilotId);
  const { device, vaultKey } = await seedTrustedDevice(ctx, seed.pilotId);
  await seedIdeas(ctx, seed.pilotId, vaultKey, projects, MOCKUP);
  const rows = await ctx.prisma.unscoped.idea.findMany({ where: { pilotId: seed.pilotId }, select: { id: true, number: true } });
  const ids = new Map(rows.map((row) => [row.number, row.id]));
  return { seed, device, vaultKey, projects, ids };
};

/** Seals `analysis` under `"<id>:analysis"` as the Runner does, its figures and its run passed: the Idée `analysed`. */
const seedAnalysis = async (ctx: ScenarioContext, vaultKey: Buffer, projects: ReadonlyMap<string, string>, ids: ReadonlyMap<number, string>, analysis: SeededAnalysis) => {
  const id = ids.get(analysis.number);
  if (id === undefined) throw new Error(`no Idée #${analysis.number} in the mockup`);
  const at = new Date(Date.now() - analysis.age * MINUTE);
  await ctx.prisma.unscoped.idea.update({
    where: { id },
    data: {
      state: ideaStateRow('analysed'),
      targetProjectId: analysis.target === null ? null : (projects.get(analysis.target) ?? null),
      targetIsNew: analysis.target === null,
      analysis: { ...sealItem(vaultKey, JSON.stringify(analysis.content(ids)), ideaItemAad(id, 'analysis')) },
      impact: analysis.impact,
      effort: analysis.effort,
      duplicateIds: analysis.duplicates.flatMap((number) => ids.get(number) ?? []),
      analysedAt: at,
      updatedAt: at,
      analysisRun: { ...analysisRun('passed', at) },
    },
  });
  return id;
};

/**
 * « Une Idée : analyse et tri » (`design/screens.json`: `idee`): #63 on its
 * page, analysed by the Rôle Idée with Claude Code, in Personal OS, #58 a
 * possible duplicate; the other Idées of the mockup beside it.
 */
export const idee = defineScenario({
  name: 'idee',
  path: '/idees',
  seed: async (ctx) => {
    const { seed, device, vaultKey, projects, ids } = await seedMockup(ctx);
    const id = await seedAnalysis(ctx, vaultKey, projects, ids, EXPORT_PDF);
    return { ...seed, device, path: `/idees/${id}` };
  },
});

/**
 * An analysis whose Contrat was not met (`idees`, state `analyse-echouee`):
 * #64, still to triage, its last run `incomplete` 4 minutes ago (no report of
 * the right shape, no figures), selected beside the list; #61 to #63
 * analysed. The Décision « Contrat incomplet » is not seeded: it hangs on a
 * StepRun of a PhaseRun, which this scenario has none of.
 */
export const ideesAnalyseEchouee = defineScenario({
  name: 'idees-analyse-echouee',
  path: '/idees',
  seed: async (ctx) => {
    const { seed, device, vaultKey, projects, ids } = await seedMockup(ctx);
    for (const analysis of [EXPORT_PDF, ...OTHERS]) await seedAnalysis(ctx, vaultKey, projects, ids, analysis);
    const failed = ids.get(64);
    if (failed === undefined) throw new Error('no Idée #64 in the mockup');
    const at = new Date(Date.now() - 4 * MINUTE);
    await ctx.prisma.unscoped.idea.update({
      where: { id: failed },
      data: { analysisRun: { ...analysisRun('incomplete', at, ['idea-analysis.report.schema', 'idea-analysis.report.figures']) }, updatedAt: at },
    });
    return { ...seed, device, path: `/idees?idee=${failed}` };
  },
});
