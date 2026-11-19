import {
  type InventoryState,
  type ProcessDefinition,
  type ProcessSources,
  type ProjectFolderPrepareError,
  type ProjectFolderState,
  READINESS_CHECK_IDS,
  type Readiness,
  type ReadinessCheck,
  type RoleCheck,
} from '@crewdeck/contracts';

/** What the Runner said last of a Local Projet's folder (`project.folder.state`), figures only. */
export interface FolderFigures {
  readonly present: boolean;
  readonly isGit: boolean;
  readonly hasCommits: boolean;
  readonly releaseBranch: boolean;
  readonly integrationBranch: boolean;
}

/**
 * What GitHub said last of a GitHub Projet's repository: the labels of the
 * Process missing, each branch there; `null` for a group never read on
 * GitHub (its Source was Local then, or GitHub failed since it moved).
 */
export interface GitHubFigures {
  readonly labelsMissing: number | null;
  readonly releaseBranch: boolean | null;
  readonly integrationBranch: boolean | null;
}

/** Everything a Projet's readiness reads, gathered by `ReadinessService` on its triggers. */
export interface ReadinessFacts {
  readonly projectId: string;
  /** The Runner linked, online or not; `null` without one. */
  readonly runner: { readonly machine: string; readonly online: boolean } | null;
  /** A Local Projet's folder: PROJET-6's `folderState`, the Runner's last figures, a preparation running or the error of the last; `null` without a folder. */
  readonly folder: {
    readonly state: ProjectFolderState;
    readonly last: FolderFigures | null;
    readonly preparing: boolean;
    readonly error: ProjectFolderPrepareError | null;
  } | null;
  readonly releaseBranch: string;
  readonly integrationBranch: string;
  /** The active version, else the draft and the count of its Manques. */
  readonly process: {
    readonly active: { readonly number: number; readonly templateName: string | null; readonly definition: ProcessDefinition } | null;
    readonly draft: { readonly definition: ProcessDefinition } | null;
    readonly draftGaps: number;
  };
  /** `RolesService.check` of the Rôles the definition's Étapes name. */
  readonly roles: readonly RoleCheck[];
  /** The Serveurs MCP the Runner declares. */
  readonly mcpServers: readonly { readonly name: string; readonly state: 'ready' | 'failed' }[];
  readonly sources: ProcessSources;
  /** The Projet's Dépôt GitHub; `null` for a Local Projet. */
  readonly repository: { readonly accessLost: boolean } | null;
  /** `null` until GitHub was read. */
  readonly github: GitHubFigures | null;
  readonly hasCode: boolean;
  readonly inventoryState: InventoryState;
}

type Check = Omit<ReadinessCheck, 'id'>;
type Evaluator = (facts: ReadinessFacts) => Check | null;

/** The definition the checks read: the active version's, the draft's while there is none. */
export const definitionOf = (facts: Pick<ReadinessFacts, 'process'>): ProcessDefinition | null => facts.process.active?.definition ?? facts.process.draft?.definition ?? null;

const toolsOf = (definition: ProcessDefinition | null) => definition?.steps.flatMap((step) => step.tools) ?? [];

/** The Rôle ids the definition's Étapes name (their `role` Outils), each once, in order. */
export const roleIdsOf = (definition: ProcessDefinition | null): string[] => [...new Set(toolsOf(definition).flatMap((tool) => (tool.kind === 'role' ? [tool.roleId] : [])))];

const ok = (facts: ReadinessCheck['facts'] = {}): Check => ({ state: 'ok', facts, fix: null });

const runnerLinked: Evaluator = ({ runner }) => (runner === null ? { state: 'missing', facts: {}, fix: 'link' } : ok({ online: runner.online, machine: runner.machine }));

const folder: Evaluator = ({ folder, runner, releaseBranch, integrationBranch }) => {
  if (folder === null) return null;
  const machine = runner?.machine ?? null;
  if (folder.state === 'missing') return { state: 'missing', facts: { machine, reason: 'missing' }, fix: 'link' };
  if (folder.preparing) return { state: 'pending', facts: { machine, reason: 'preparing' }, fix: null };
  if (folder.state === 'pending' || folder.last === null) return { state: 'pending', facts: { machine, reason: 'waiting' }, fix: null };
  const { last } = folder;
  if (!last.present) return { state: 'missing', facts: { machine, reason: 'missing' }, fix: 'link' };
  const branches = { release: releaseBranch, integration: integrationBranch, error: folder.error };
  if (!last.isGit) return { state: 'missing', facts: { machine, reason: 'not-git', ...branches }, fix: 'auto' };
  if (!last.hasCommits) return { state: 'missing', facts: { machine, reason: 'no-commit', ...branches }, fix: 'auto' };
  if (!last.releaseBranch) return { state: 'missing', facts: { machine, reason: 'no-release', ...branches }, fix: null };
  if (!last.integrationBranch) return { state: 'missing', facts: { machine, reason: 'no-integration', ...branches }, fix: 'auto' };
  return ok({ machine });
};

const engines: Evaluator = ({ roles }) => {
  const facts: ReadinessCheck['facts'] = {};
  for (const role of roles) facts[role.roleId] = role.usable ? role.engine : null;
  return roles.every((role) => role.usable) ? ok(facts) : { state: 'missing', facts, fix: 'link' };
};

const tools: Evaluator = (facts) => {
  const named = toolsOf(definitionOf(facts));
  const declared = new Map(facts.mcpServers.map((server) => [server.name, server.state]));
  const mcp = [...new Set(named.flatMap((tool) => (tool.kind === 'mcp' ? [tool.name] : [])))];
  const missing = mcp.filter((name) => !declared.has(name));
  const failed = mcp.filter((name) => declared.get(name) === 'failed');
  const connector = named.some((tool) => tool.kind === 'connector');
  // Only the checks that apply: an Étape naming neither a Serveur MCP nor a Connecteur.
  if (mcp.length === 0 && !connector) return null;
  const githubUnavailable = connector && (facts.repository === null || facts.repository.accessLost);
  const figures = { mcpMissing: missing.join(', ') || null, mcpFailed: failed.join(', ') || null, githubUnavailable };
  return missing.length === 0 && failed.length === 0 && !githubUnavailable ? ok(figures) : { state: 'missing', facts: figures, fix: 'link' };
};

// An active version never has a Manque (ADR 0011): only a draft waits for its activation.
const processCheck: Evaluator = ({ process }) =>
  process.active ? ok({ version: process.active.number, templateName: process.active.templateName }) : { state: 'missing', facts: { gaps: process.draftGaps }, fix: 'link' };

const labels: Evaluator = ({ sources, github }) => {
  if (sources.ticket !== 'github') return null;
  if (github === null || github.labelsMissing === null) return { state: 'pending', facts: {}, fix: null };
  return github.labelsMissing === 0 ? ok({ missing: 0 }) : { state: 'missing', facts: { missing: github.labelsMissing }, fix: 'auto' };
};

const branches: Evaluator = ({ sources, github, releaseBranch, integrationBranch }) => {
  if (sources.code !== 'github') return null;
  if (github === null || github.releaseBranch === null || github.integrationBranch === null) return { state: 'pending', facts: { release: releaseBranch, integration: integrationBranch }, fix: null };
  const facts = { release: releaseBranch, integration: integrationBranch, releaseExists: github.releaseBranch, integrationExists: github.integrationBranch };
  if (!github.releaseBranch) return { state: 'missing', facts, fix: null };
  return github.integrationBranch ? ok(facts) : { state: 'missing', facts, fix: 'auto' };
};

const INVENTORY_PENDING: readonly InventoryState[] = ['drafting', 'to-approve', 'awaiting-merge'];

// Drafted and approved elsewhere (PROJET-4, PROJET-5): never fixed here.
const inventory: Evaluator = ({ hasCode, inventoryState }) => {
  if (!hasCode) return null;
  const state = inventoryState === 'approved' ? 'ok' : INVENTORY_PENDING.includes(inventoryState) ? 'pending' : 'missing';
  return { state, facts: { state: inventoryState }, fix: null };
};

const EVALUATORS: Readonly<Record<ReadinessCheck['id'], Evaluator>> = {
  'runner-linked': runnerLinked,
  folder,
  engines,
  tools,
  process: processCheck,
  labels,
  branches,
  inventory,
};

/**
 * A Projet's readiness from its facts (US-4): the checks that apply, the
 * missing ones first then in `READINESS_CHECK_IDS`' order, `ready` once
 * every one is `ok`. Pure: `ReadinessService` gathers the facts.
 */
export const evaluateReadiness = (facts: ReadinessFacts, now: Date = new Date()): Readiness => {
  const checks = READINESS_CHECK_IDS.flatMap((id) => {
    const check = EVALUATORS[id](facts);
    return check === null ? [] : [{ id, ...check }];
  });
  const sorted = [...checks.filter((check) => check.state === 'missing'), ...checks.filter((check) => check.state !== 'missing')];
  return { ready: checks.every((check) => check.state === 'ok'), computedAt: now.toISOString(), checks: sorted };
};
