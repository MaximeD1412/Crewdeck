import { t, type MessageKey } from '@crewdeck/sdk';

/** The rules of a Skill's `step.report` the server checks itself (RUNNER-12, IDEE-2): no Contrat declares them. */
const REPORT_RULES: Readonly<Record<string, MessageKey>> = {
  'report.schema': 'decision.contractIncomplete.reportSchema',
  'report.missing': 'decision.contractIncomplete.reportMissing',
};

/** The label of a rule of the report the server checks, `undefined` for a Contrat's own. */
export const reportRuleLabel = (ruleId: string): string | undefined => {
  const key = REPORT_RULES[ruleId];
  return key === undefined ? undefined : t(key);
};
