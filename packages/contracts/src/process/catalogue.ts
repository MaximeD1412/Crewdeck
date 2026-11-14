import { z } from 'zod';
import type { AgentRole } from '../values.js';
import { ARTIFACT_TYPES, type ArtifactType } from './artifact-types.js';
import type { Port, Step, ToolKind } from './definition.js';

/**
 * The catalogue of the Étapes (ADR 0011): each `kind` a definition's Étape
 * may have, with its default name and ports, its family, the capabilities
 * it needs, whether it judges, its default Rôle and Skill and its Contrat.
 * Data in French as the Contrats' labels are: a name is copied into the
 * definition when an Étape is added. Imports nothing of `contrats/`, which
 * takes its Étapes from here.
 */

/** The kinds of the `agent` family, in the order of the Contrats' Étapes (`STEP_IDS`). */
export const AGENT_KINDS = ['idea-analysis', 'inventory', 'prd', 'mockups', 'technical-design', 'cross-review', 'split', 'code', 'review'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** Every kind of Étape: the agents', the Pilote's gates, the Commande, the Étapes du produit. */
export const STEP_KINDS = [...AGENT_KINDS, 'idea-triage', 'approval', 'visual-review', 'command', 'checks', 'merge'] as const;
export const zStepKind = z.enum(STEP_KINDS);
export type StepKind = z.infer<typeof zStepKind>;

/** `gate`: the Pilote's (a Décision); `core`: the Étapes du produit, `checks` and `merge`. */
export const STEP_FAMILIES = ['agent', 'gate', 'command', 'core'] as const;
export type StepFamily = (typeof STEP_FAMILIES)[number];

/** What an Outil gives an Étape: `agent` a Session, `command` a Commande to run, `ci` the CI of the code's GitHub Source. */
export const CAPABILITIES = ['agent', 'command', 'ci'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** A default port: its id, the types it may take (the first by default), its note, and the Entrée whose type it follows. */
export interface PortSpec {
  readonly id: string;
  readonly types: readonly ArtifactType[];
  readonly note?: string;
  readonly sameTypeAs?: string;
}

export interface StepKindSpec {
  readonly family: StepFamily;
  /** The default name, copied into the definition. */
  readonly name: string;
  /** Where the canvas's menu offers it; `null`: never offered. */
  readonly menu: 'process' | 'reviews' | 'runner' | null;
  /** Gives a Verdict « changements » a Retour may follow. */
  readonly judges: boolean;
  /** Any one suffices; empty: none. */
  readonly needs: readonly Capability[];
  /** `keep-one`: a second may go, never the last. */
  readonly removable: 'yes' | 'never' | 'keep-one';
  /** At most one in a definition. */
  readonly unique: boolean;
  readonly inputs: readonly PortSpec[];
  readonly outputs: readonly PortSpec[];
  /** The types of the Entrées the Pilote may add. */
  readonly extraInputs: readonly ArtifactType[];
  readonly role: AgentRole | null;
  readonly skill: string | null;
  /** The id of its Contrat in `CONTRATS`, set by the Étape's ticket. */
  readonly contrat: string | null;
}

type Defaults = Pick<StepKindSpec, 'menu' | 'judges' | 'needs' | 'removable' | 'unique' | 'extraInputs' | 'role' | 'skill' | 'contrat'>;

const agent = (role: AgentRole, skill: string): Defaults => ({
  menu: 'process',
  judges: false,
  needs: ['agent'],
  removable: 'yes',
  unique: false,
  extraInputs: [],
  role,
  skill,
  contrat: null,
});
const NOTHING: Defaults = { menu: 'process', judges: false, needs: [], removable: 'yes', unique: false, extraInputs: [], role: null, skill: null, contrat: null };
const CORE: Defaults = { ...NOTHING, menu: null, removable: 'never', unique: true };

const port = (id: string, ...types: ArtifactType[]): PortSpec => ({ id, types });
const DOCUMENTS: readonly ArtifactType[] = ['prd', 'mockups', 'technical-design', 'inventory', 'ticket'];

export const CATALOGUE: Readonly<Record<StepKind, StepKindSpec>> = {
  'idea-analysis': { ...agent('idea', 'idea-analysis'), family: 'agent', name: 'Analyse de l’Idée', inputs: [port('idee', 'idea')], outputs: [port('idee', 'idea')] },
  inventory: { ...agent('design', 'inventory'), family: 'agent', name: 'Inventaire', inputs: [], outputs: [port('inventaire', 'inventory')] },
  prd: { ...agent('design', 'product-design'), family: 'agent', name: 'PRD', inputs: [port('idee', 'idea')], outputs: [port('prd', 'prd')] },
  mockups: { ...agent('design', 'visual-design'), family: 'agent', name: 'Maquettes', inputs: [port('prd', 'prd')], outputs: [port('maquettes', 'mockups')] },
  'technical-design': {
    ...agent('design', 'technical-design'),
    family: 'agent',
    name: 'Conception technique',
    inputs: [port('prd', 'prd'), port('maquettes', 'mockups')],
    outputs: [port('conception', 'technical-design')],
  },
  'cross-review': {
    ...agent('review', 'cross-review'),
    menu: 'reviews',
    judges: true,
    family: 'agent',
    name: 'Revue croisée',
    inputs: [port('document', 'prd', 'technical-design', 'mockups', 'inventory')],
    outputs: [port('verdict', 'verdict')],
  },
  split: {
    ...agent('design', 'plan-backlog'),
    family: 'agent',
    name: 'Découpage en Tickets',
    inputs: [port('prd', 'prd'), port('maquettes', 'mockups'), port('conception', 'technical-design')],
    outputs: [port('ticket', 'ticket')],
  },
  code: { ...agent('code', 'code'), family: 'agent', name: 'Code', inputs: [port('ticket', 'ticket')], outputs: [port('changement', 'code-change')] },
  review: {
    ...agent('review', 'review'),
    menu: 'reviews',
    judges: true,
    removable: 'keep-one',
    extraInputs: ['verdict'],
    family: 'agent',
    name: 'Review',
    inputs: [port('changement', 'code-change')],
    outputs: [port('verdict', 'verdict')],
  },
  'idea-triage': { ...NOTHING, family: 'gate', name: 'Tri de l’Idée', inputs: [port('idee', 'idea')], outputs: [{ ...port('idee', 'idea'), note: 'retenue' }] },
  approval: {
    ...NOTHING,
    judges: true,
    extraInputs: ['verdict'],
    family: 'gate',
    name: 'Approbation',
    inputs: [port('document', ...DOCUMENTS)],
    outputs: [{ ...port('document', ...DOCUMENTS), sameTypeAs: 'document' }],
  },
  'visual-review': {
    ...NOTHING,
    menu: 'reviews',
    judges: true,
    family: 'gate',
    name: 'Revue visuelle',
    inputs: [port('changement', 'code-change'), port('maquettes', 'mockups')],
    outputs: [port('verdict', 'verdict')],
  },
  command: {
    ...NOTHING,
    menu: 'runner',
    needs: ['command'],
    extraInputs: ARTIFACT_TYPES,
    family: 'command',
    name: 'Commande',
    inputs: [port('changement', 'code-change')],
    outputs: [port('verdict', 'verdict', 'delivery')],
  },
  checks: { ...CORE, needs: ['ci', 'command'], family: 'core', name: 'Checks', inputs: [port('changement', 'code-change')], outputs: [port('verdict', 'verdict')] },
  merge: {
    ...CORE,
    extraInputs: ['verdict'],
    family: 'core',
    name: 'Merge',
    inputs: [port('changement', 'code-change')],
    outputs: [{ ...port('changement', 'code-change'), note: 'mergé' }],
  },
};

/** What each kind of Outil gives; the `connector` (GitHub) gives `ci` only when the code's Source is GitHub, which `findGaps` checks. */
export const TOOL_CAPABILITIES: Readonly<Record<ToolKind, readonly Capability[]>> = {
  role: ['agent'],
  skill: [],
  mcp: [],
  command: ['command'],
  connector: ['ci'],
};

const defaultPort = (spec: PortSpec): Port => ({ id: spec.id, type: spec.types[0]!, ...(spec.note === undefined ? {} : { note: spec.note }) });

/**
 * A new Étape of `kind` where the canvas puts it: the kind's name, its
 * default ports and, for an agent, its Rôle and Skill as Outils.
 */
export const defaultStep = (kind: StepKind, at: Pick<Step, 'id' | 'phaseId' | 'col' | 'row'>): Step => {
  const spec = CATALOGUE[kind];
  return {
    ...at,
    kind,
    name: spec.name,
    inputs: spec.inputs.map(defaultPort),
    outputs: spec.outputs.map(defaultPort),
    tools: [
      ...(spec.role === null ? [] : [{ kind: 'role' as const, roleId: spec.role }]),
      ...(spec.skill === null ? [] : [{ kind: 'skill' as const, skillId: spec.skill }]),
    ],
  };
};
