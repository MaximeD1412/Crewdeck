import type { ForEach, ProcessChange, Tool } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import { roleName } from './canvas.js';

/** « pour chaque Ticket prêt », or « une fois »: a Phase's repetition, inside the change's sentence. */
const repeatOf = (forEach: ForEach | null): string =>
  forEach === null ? t('process.diff.phase.repeat.once') : t('process.diff.phase.repeat.forEach', { forEach: t(`process.forEach.${forEach}`) });

const toolLabel = (verb: 'attached' | 'detached', tool: Tool, step: string, roleNames: Readonly<Record<string, string>>): string => {
  switch (tool.kind) {
    case 'role':
      return t(`process.diff.tool.${verb}.role`, { name: roleName(tool.roleId, roleNames), step });
    case 'skill':
      return t(`process.diff.tool.${verb}.skill`, { name: tool.skillId, step });
    case 'mcp':
      return t(`process.diff.tool.${verb}.mcp`, { name: tool.name, step });
    case 'command':
      // Its text is in the sealed part, PROCESS-12's to open.
      return t(`process.diff.tool.${verb}.command`, { step });
    case 'connector':
      return t(`process.diff.tool.${verb}.connector`, { step });
  }
};

/** One change of `diffDefinitions` in French, as the activation's confirmation and the footer list it. */
export const changeLabel = (change: ProcessChange, roleNames: Readonly<Record<string, string>> = {}): string => {
  switch (change.kind) {
    case 'phase.added':
      return t('process.diff.phase.added', { name: change.phase.name });
    case 'phase.removed':
      return t('process.diff.phase.removed', { name: change.phase.name });
    case 'phase.renamed':
      return t('process.diff.phase.renamed', { from: change.from, to: change.to });
    case 'phase.for-each-changed':
      return t('process.diff.phase.forEachChanged', { name: change.phase.name, from: repeatOf(change.from), to: repeatOf(change.to) });
    case 'step.added':
      return t('process.diff.step.added', { name: change.step.name, phase: change.phase.name });
    case 'step.removed':
      return t('process.diff.step.removed', { name: change.step.name, phase: change.phase.name });
    case 'step.moved':
      return t('process.diff.step.moved', { name: change.step.name, from: change.from.name, to: change.to.name });
    case 'arrow.added':
      return t('process.diff.arrow.added', { from: change.from.name, to: change.to.name });
    case 'arrow.removed':
      return t('process.diff.arrow.removed', { from: change.from.name, to: change.to.name });
    case 'loop-back.added':
      return t('process.diff.loopBack.added', { from: change.from.name, to: change.to.name, max: change.max });
    case 'loop-back.removed':
      return t('process.diff.loopBack.removed', { from: change.from.name, to: change.to.name });
    case 'loop-back.max-changed':
      return t('process.diff.loopBack.maxChanged', { from: change.from.name, to: change.to.name, before: change.before, after: change.after });
    case 'tool.attached':
      return toolLabel('attached', change.tool, change.step.name, roleNames);
    case 'tool.detached':
      return toolLabel('detached', change.tool, change.step.name, roleNames);
    case 'layout.changed':
      return t('process.diff.layout');
  }
};

/** Every change, in the order `diffDefinitions` gives. */
export const changeLabels = (changes: readonly ProcessChange[], roleNames: Readonly<Record<string, string>> = {}): string[] =>
  changes.map((change) => changeLabel(change, roleNames));
