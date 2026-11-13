/**
 * What « Premiers pas » and « Runner et Comptes IA » say of a Moteur and its
 * models (US-38), the same on both pages.
 */
import { t, type ComposantData, type EngineAccount, type StatusBadge } from '@crewdeck/sdk';

type Badge = ComposantData<typeof StatusBadge>;
type Model = EngineAccount['models'][number];

/** The Compte IA's badges: not installed, connected by subscription or API key, or « connexion requise »; then « version non vérifiée » when the adapter does not know it (risk IA-3). */
export const accountBadges = ({ installed, knownVersion, kind, state }: EngineAccount): Badge[] => {
  const account: Badge = !installed
    ? { tone: 'caution', label: t('aiAccounts.state.notInstalled') }
    : state === 'connected' && kind !== 'none'
      ? { tone: 'go', label: t(`aiAccounts.state.${kind}`) }
      : { tone: 'caution', label: t('aiAccounts.state.loginRequired') };
  return installed && !knownVersion ? [account, { tone: 'caution', label: t('aiAccounts.unknownVersion') }] : [account];
};

/** « disponible », « quota atteint », « connexion requise », or « indisponible » outside the plan. */
export const modelBadge = ({ usable, reason }: Model): Badge =>
  usable || !reason
    ? { tone: usable ? 'go' : 'caution', label: t(usable ? 'aiAccounts.model.usable' : 'aiAccounts.model.login-required') }
    : { tone: reason === 'not-in-plan' ? 'halt' : 'caution', label: t(`aiAccounts.model.${reason}`) };

/** Why the model is not usable when its badge does not say it all: « indisponible avec cet abonnement ». */
export const modelReason = ({ usable, reason }: Model): string | undefined =>
  !usable && reason === 'not-in-plan' ? t('aiAccounts.model.notInPlanMeta') : undefined;

export const engineName = (engine: EngineAccount['engine']): string => t(`aiAccounts.engine.${engine}`);

/** Connected: Rôles can run on its models. */
export const isConnected = ({ installed, kind, state }: EngineAccount): boolean => installed && state === 'connected' && kind !== 'none';
