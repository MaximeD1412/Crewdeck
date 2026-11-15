import { z } from 'zod';
import { AGENT_KINDS } from '../process/catalogue.js';

/**
 * Contrats as data (ADR 0005): each Étape's output is checked against a
 * declaration, `contrats/<step>.ts`, that `contracts:generate` writes to JSON
 * for the Runner, the only one that interprets it (on the Étape's worktree and
 * its PR). The server and the page show the rules' labels from the same
 * declarations (`contratLabel`), so the content never travels.
 */

/** The Étapes of the Process that may have a Contrat: the agent kinds of the catalogue (ADR 0011). */
export const STEP_IDS = AGENT_KINDS;
export const zStepId = z.enum(STEP_IDS);
export type StepId = z.infer<typeof zStepId>;

/** `bloquant` makes the verdict `incomplete`; `attention` only lists the rule in `warningRuleIds`. */
export const RULE_SEVERITIES = ['bloquant', 'attention'] as const;
export const zRuleSeverity = z.enum(RULE_SEVERITIES);
export type RuleSeverity = z.infer<typeof zRuleSeverity>;

/** A path in the Étape's worktree: relative, `/`-separated, never out of it. */
const zWorktreePath = z
  .string()
  .min(1)
  .refine((path) => !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), 'Un chemin relatif au worktree, sans « .. ».');

/** A glob over the worktree (`*`, `?`, `**`, `[…]`, `{a,b}`), relative as a path is. */
const zGlob = zWorktreePath;

const isRegex = (source: string): boolean => {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
};
const captureGroups = (source: string): number => (new RegExp(`${source}|`).exec('') ?? ['']).length - 1;

/**
 * A regex the Runner compiles with Go's RE2: the common subset of RE2 and
 * JavaScript (no lookaround, no backreference). The Go tests compile every
 * generated Contrat's regexes.
 */
const zRegex = z.string().min(1).refine(isRegex, 'Une expression régulière valide.');

/** A JSON Schema (draft 2020-12), as an object. */
const zJsonSchema = z.record(z.string(), z.unknown());

const ruleBase = {
  /** Stable for ever (`prd.stories.unique`): the verdict names the rule by it. */
  id: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/),
  /** French, shown to the Pilote (« Chaque story a un identifiant unique »). */
  label: z.string().min(1),
  severity: zRuleSeverity,
};

const onePathOrGlob = (rule: { path?: string; glob?: string }): boolean => (rule.path === undefined) !== (rule.glob === undefined);
const ONE_PATH_OR_GLOB = 'Un chemin ou un glob, pas les deux.';

/** `path` exists (a file or a folder), or at least `min` (1 by default) files match `glob`. */
export const zFileRule = z
  .strictObject({ ...ruleBase, kind: z.literal('file'), path: zWorktreePath.optional(), glob: zGlob.optional(), min: z.int().positive().optional() })
  .refine(onePathOrGlob, ONE_PATH_OR_GLOB)
  .refine((rule) => rule.min === undefined || rule.glob !== undefined, 'Un minimum ne va qu’avec un glob.');

/** The Markdown file at `path` has these headings in this order (others between them allowed), of `level` when given. */
export const zSectionsRule = z.strictObject({
  ...ruleBase,
  kind: z.literal('sections'),
  path: zWorktreePath,
  headings: z.array(z.string().min(1)).min(1),
  level: z.int().min(1).max(6).optional(),
});

/**
 * At least `min` (1 by default) lines of the file at `path`, or of the files
 * matching `glob`, match `regex`; with `unique`, its capture group 1 never
 * repeats across them.
 */
export const zPatternRule = z
  .strictObject({
    ...ruleBase,
    kind: z.literal('pattern'),
    path: zWorktreePath.optional(),
    glob: zGlob.optional(),
    regex: zRegex,
    unique: z.boolean().optional(),
    min: z.int().positive().optional(),
  })
  .refine(onePathOrGlob, ONE_PATH_OR_GLOB)
  .refine((rule) => !rule.unique || captureGroups(rule.regex) >= 1, 'Une règle unique capture la valeur dans le groupe 1.');

/** At least one file matches `glob`, and each has a YAML front matter valid against `schema`. */
export const zFrontMatterRule = z.strictObject({ ...ruleBase, kind: z.literal('front-matter'), glob: zGlob, schema: zJsonSchema });

/** The file at `path` is JSON valid against `schema`. */
export const zJsonRule = z.strictObject({ ...ruleBase, kind: z.literal('json'), path: zWorktreePath, schema: zJsonSchema });

/**
 * The Étape's PR exists and: targets `base` (`integration`: the Projet's
 * integration branch), comes from a branch matching `branch`, has a body
 * matching every regex of `body` (`^` and `$` at each line), carries every
 * one of `labels` (not `label`: that is the rule's own, French).
 */
export const zPrRule = z.strictObject({
  ...ruleBase,
  kind: z.literal('pr'),
  base: z.string().min(1).optional(),
  branch: zRegex.optional(),
  body: z.array(zRegex).optional(),
  labels: z.array(z.string().min(1)).min(1).optional(),
});

/** A named Go function of `apps/runner/internal/contrat/checks/`, only for what no other kind can say. */
export const zCheckRule = z.strictObject({ ...ruleBase, kind: z.literal('check'), name: z.string().regex(/^[a-z0-9-]+$/), params: z.record(z.string(), z.unknown()).optional() });

export const RULE_KINDS = ['file', 'sections', 'pattern', 'front-matter', 'json', 'pr', 'check'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const zRule = z.discriminatedUnion('kind', [zFileRule, zSectionsRule, zPatternRule, zFrontMatterRule, zJsonRule, zPrRule, zCheckRule]);
export type Rule = z.infer<typeof zRule>;

/** A Contrat: its id, its version (bumped by any change of a rule), its Étape and its rules, in the order they are checked. */
export const zContrat = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    version: z.int().positive(),
    step: zStepId,
    rules: z.array(zRule),
  })
  .superRefine((contrat, ctx) => {
    const seen = new Set<string>();
    for (const rule of contrat.rules) {
      if (seen.has(rule.id)) ctx.addIssue({ code: 'custom', message: `La règle ${rule.id} est déclarée deux fois.`, path: ['rules'] });
      seen.add(rule.id);
    }
  });
export type Contrat = z.infer<typeof zContrat>;

/**
 * Declares a Contrat: validated now (a wrong declaration fails the build),
 * returned as written. A rule's id never changes; changing a rule's parameters
 * or its label bumps `version` and moves the previous declaration to
 * `history/<step>.v<n>.ts`.
 */
export const defineContrat = <const C extends z.input<typeof zContrat>>(contrat: C): C => {
  zContrat.parse(contrat);
  return contrat;
};

/** What the Runner sends of a check: never the content, only the ids of the rules that failed. */
export const VERDICT_STATUSES = ['passed', 'incomplete'] as const;
export const zVerdict = z.object({
  contractId: z.string().min(1),
  version: z.int().positive(),
  status: z.enum(VERDICT_STATUSES),
  /** The `bloquant` rules that failed, in the Contrat's order: `incomplete` when there is one. */
  failedRuleIds: z.array(z.string()),
  /** The `attention` rules that failed. */
  warningRuleIds: z.array(z.string()),
  /** The commit of the PR the check read, when the Étape has one. */
  headSha: z.string().min(1).optional(),
})
  // Its own Go type, `contracts.ContratVerdict`, wherever a generated schema holds it.
  .meta({ id: 'ContratVerdict' });
export type Verdict = z.infer<typeof zVerdict>;
