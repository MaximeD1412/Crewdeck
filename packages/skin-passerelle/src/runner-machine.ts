import { t, type ComposantData, type PageDemarrage } from '@crewdeck/sdk';

type Machine = Pick<NonNullable<ComposantData<typeof PageDemarrage>['runner']>, 'os' | 'arch' | 'wsl'>;

/** The Runner's system as « Premiers pas » and « Runner et Comptes IA » say it: « Windows (WSL) · amd64 », « macOS · arm64 ». */
export const systemOf = ({ os, arch, wsl }: Machine): string =>
  t('demarrage.runner.systemArch', { system: t(`demarrage.runner.system.${wsl ? 'wsl' : os === 'darwin' ? 'macos' : 'linux'}`), arch });
