import { ENGINE_IDS, isUsableAccount, type AiAccount, type EngineId } from '@crewdeck/contracts';
import type { EngineAccount } from '@crewdeck/sdk';

/** `crewdeck-runner login claude`, `crewdeck-runner login codex`: the command that connects a Moteur's Compte IA on the Runner. */
export const loginCommand = (engine: EngineId): string => `crewdeck-runner login ${engine === 'claude-code' ? 'claude' : 'codex'}`;

/**
 * Every Moteur, in the order of their ids, as the Pilote's Runner last
 * reported it (the `ai-account` slice); one it never reported, as not
 * connected yet. Never a credential: the Runner keeps it.
 */
export const engineAccounts = (accounts: Iterable<AiAccount>): EngineAccount[] => {
  const byEngine = new Map([...accounts].map((account) => [account.engine, account]));
  return ENGINE_IDS.map((engine) => {
    const account = byEngine.get(engine);
    return account
      ? {
          engine,
          installed: account.installed,
          knownVersion: account.knownVersion,
          kind: account.kind,
          state: account.state,
          models: account.models,
          command: loginCommand(engine),
        }
      : { engine, installed: true, knownVersion: true, kind: 'none', state: 'login-required', models: [], command: loginCommand(engine) };
  });
};

/** A Rôle can run on one of them (the server's rule for « Premiers pas », `getting-started.no-usable-engine`). */
export const anyUsable = (accounts: Iterable<AiAccount>): boolean => [...accounts].some(isUsableAccount);
