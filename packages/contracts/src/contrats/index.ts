import type { Contrat } from './define.js';

export * from './define.js';

/**
 * The current Contrat of each Étape, one file each (`contrats/<step>.ts`),
 * added by the Étape's own ticket. `contracts:generate` writes each to
 * `apps/runner/internal/contrat/contrats/<id>.v<version>.json`, which the
 * Runner embeds.
 */
export const CONTRATS: readonly Contrat[] = [];

/**
 * Every past version, `history/<step>.v<n>.ts`, kept so that an old verdict
 * stays readable: a change of a rule bumps the Contrat's version and moves the
 * previous declaration here.
 */
export const CONTRAT_HISTORY: readonly Contrat[] = [];

export interface ContratRegistry {
  /** The label of `ruleId` in that version of the Contrat; `undefined` when the version or the rule is unknown. */
  label(contractId: string, version: number, ruleId: string): string | undefined;
  /** The version the Runner checks. */
  current(contractId: string): Contrat | undefined;
}

/** The registry of `current` and `history`, refusing a version declared twice or a past version not below its current one. */
export const contratRegistry = (current: readonly Contrat[], history: readonly Contrat[]): ContratRegistry => {
  const byId = new Map<string, Contrat>();
  for (const contrat of current) {
    if (byId.has(contrat.id)) throw new Error(`The Contrat ${contrat.id} has two current versions.`);
    byId.set(contrat.id, contrat);
  }
  const byVersion = new Map<string, Contrat>();
  for (const contrat of [...current, ...history]) {
    const key = `${contrat.id} v${contrat.version}`;
    if (byVersion.has(key)) throw new Error(`The Contrat ${key} is declared twice.`);
    const latest = byId.get(contrat.id);
    if (!current.includes(contrat) && (latest === undefined || contrat.version >= latest.version)) {
      throw new Error(`The past version ${key} is not below a current version.`);
    }
    byVersion.set(key, contrat);
  }
  return {
    label: (contractId, version, ruleId) => byVersion.get(`${contractId} v${version}`)?.rules.find((rule) => rule.id === ruleId)?.label,
    current: (contractId) => byId.get(contractId),
  };
};

const registry = contratRegistry(CONTRATS, CONTRAT_HISTORY);

/** The French label of a rule of a verdict, whatever the version it was checked against: for the server and the page. */
export const contratLabel = (contractId: string, version: number, ruleId: string): string | undefined => registry.label(contractId, version, ruleId);
