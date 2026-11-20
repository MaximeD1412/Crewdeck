import { type ContratRegistry, contratLabel, type Decision } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import { reportRuleLabel } from '../report-rules.js';
import { registerDecisionView, type DecisionView } from './registry.js';
import { STEP_RUN_ACTIONS, stepRunTitle, textParam } from './step-run.js';

const numberParam = (decision: Pick<Decision, 'params'>, name: string): number | null => {
  const value = decision.params[name];
  return typeof value === 'number' ? value : null;
};

/**
 * « Contrat incomplet » in « À toi » (ATOI-2, ADR 0005): the Étape (and its
 * item), the Phase in the meta, and the label of the first rule its Contrat
 * failed, read from the declarations of the version the verdict was checked
 * against, the same the server reads, « et 2 autres » when more failed.
 * « Relancer l’Étape », « Voir ». `labels` is the Contrats' registry.
 */
export const createContractIncompleteView = (labels: Pick<ContratRegistry, 'label'>): DecisionView => {
  const ruleLabel = (decision: Decision, ruleId: string): string => {
    const contractId = textParam(decision, 'contractId');
    const version = numberParam(decision, 'contractVersion');
    const declared = contractId === null || version === null ? undefined : labels.label(contractId, version, ruleId);
    if (declared !== undefined) return declared;
    return reportRuleLabel(ruleId) ?? t('decision.contractIncomplete.unknownRule', { id: ruleId });
  };
  return {
    title: stepRunTitle,
    context: (decision) => {
      const [first, ...rest] = (textParam(decision, 'failedRuleIds') ?? '').split(',').filter((id) => id.length > 0);
      if (first === undefined) return null;
      const rule = ruleLabel(decision, first);
      const others = Math.max(rest.length, (numberParam(decision, 'failedCount') ?? 0) - 1);
      if (others === 0) return rule;
      return t(others === 1 ? 'decision.contractIncomplete.more.one' : 'decision.contractIncomplete.more.other', { rule, count: others });
    },
    actions: STEP_RUN_ACTIONS,
  };
};

export const contractIncompleteView = createContractIncompleteView({ label: contratLabel });

registerDecisionView('contract-incomplete', contractIncompleteView);
