import { type ArtifactType, CATALOGUE, PROCESS_CREWDECK_NAME, type ProcessDefinition, STEP_KINDS, type StepFamily, type StepKind, type StepKindSpec } from '@crewdeck/contracts';
import { t, type ComposantData, type Menu } from '@crewdeck/sdk';
import { typeLabel } from './canvas.js';

export type MenuData = ComposantData<typeof Menu>;
type MenuGroup = MenuData['groups'][number];
type Icon = NonNullable<MenuGroup['items'][number]['icon']>;
type MenuName = NonNullable<StepKindSpec['menu']>;

const ICONS: Readonly<Record<Exclude<StepFamily, 'core'>, Icon>> = { agent: 'spark', gate: 'user', command: 'terminal' };
/** The kinds whose detail says what they are rather than their ports. */
const DETAILS: Partial<Record<StepKind, `process.catalogue.detail.${'review' | 'command' | 'approval' | 'crossReview'}`>> = {
  review: 'process.catalogue.detail.review',
  'cross-review': 'process.catalogue.detail.crossReview',
  approval: 'process.catalogue.detail.approval',
  command: 'process.catalogue.detail.command',
};
/** From this many Types d'artefact on one side, « … ». */
const MANY_TYPES = 3;

/** One side of a kind's ports: the types its ports take, or « … » when three or more. */
const side = (ports: StepKindSpec['inputs']): string => {
  const types = [...new Set(ports.flatMap((port) => port.types))] as ArtifactType[];
  return types.length >= MANY_TYPES ? t('process.catalogue.many') : types.map(typeLabel).join(', ');
};

const detailOf = (kind: StepKind, spec: StepKindSpec): string => {
  const own = DETAILS[kind];
  if (own) return t(own);
  return t('process.catalogue.ports', { inputs: side(spec.inputs), outputs: side(spec.outputs) }).trim();
};

const groupLabel = (menu: MenuName): string =>
  menu === 'process' ? t('process.catalogue.group.process', { template: PROCESS_CREWDECK_NAME }) : t(`process.catalogue.group.${menu}`);

/**
 * The catalogue's Menu (US-93), pure: titled with the Phase the Étape goes
 * to, one group per `menu` of the catalogue in its order, each kind with its
 * family's icon and its ports; the Étapes du produit (`menu: null`) never in
 * it; a `unique` kind the definition holds disabled.
 */
export const catalogueMenu = (
  definition: ProcessDefinition,
  phaseName: string,
  catalogue: Readonly<Record<StepKind, StepKindSpec>> = CATALOGUE,
): MenuData => {
  const held = new Set(definition.steps.map((step) => step.kind));
  const groups = new Map<MenuName, MenuGroup['items']>();
  for (const kind of STEP_KINDS) {
    const spec = catalogue[kind];
    if (spec.menu === null || spec.family === 'core') continue;
    const items = groups.get(spec.menu) ?? [];
    items.push({ id: kind, label: spec.name, icon: ICONS[spec.family], detail: detailOf(kind, spec), selected: false, disabled: spec.unique && held.has(kind) });
    groups.set(spec.menu, items);
  }
  return {
    title: t('process.catalogue.title', { phase: phaseName }),
    groups: [...groups].map(([menu, items]) => ({ label: groupLabel(menu), items })),
  };
};
