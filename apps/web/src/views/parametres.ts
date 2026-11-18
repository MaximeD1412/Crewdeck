import {
  AGENT_ROLES,
  checkRole,
  usableModelsOf,
  withDefaultRoles,
  type AccountSettings,
  type AiAccount,
  type Device,
  type EngineId,
  type Me,
  type RoleChoice,
} from '@crewdeck/contracts';
import { zLinkError, t, type AccountIdentities, type Card, type ComposantData, type Icon, type ListRow, type RoleSettings, type Select, type SettingRow } from '@crewdeck/sdk';
import type { PlacedNode } from '../placed.js';
import { devicesCard } from './devices.js';

/** The time zones the Pilote may pick: the IANA zones the browser knows. */
export const timeZones = (): readonly string[] => Intl.supportedValuesOf('timeZone');

const card = (slot: string, data: ComposantData<typeof Card>, children: readonly PlacedNode[]): PlacedNode => ({ tag: 'cd-card', slot, data, children });

const modders = (): PlacedNode =>
  card('modders', { title: t('settings.modders.title'), label: t('settings.modders.label'), flush: true }, [
    {
      tag: 'cd-list-row',
      data: {
        title: t('settings.modders.library.title'),
        meta: t('settings.modders.library.meta'),
        icon: 'layers',
        href: '/parametres/composants',
      } satisfies ComposantData<typeof ListRow>,
      // The chevron of a row that leads to a page, as the mockup draws it.
      children: [{ tag: 'cd-icon', slot: 'trailing', data: { name: 'chevron-right', size: 'sm' } satisfies ComposantData<typeof Icon> }],
    },
  ]);

const account = (settings: AccountSettings, zones: readonly string[]): PlacedNode => {
  const options = (zones.includes(settings.timeZone) ? [...zones] : [...zones, settings.timeZone].sort()).map((zone) => ({
    value: zone,
    label: zone,
    disabled: false,
  }));
  return card('account', { title: t('settings.account.title'), label: t('settings.account.label') }, [
    {
      tag: 'cd-setting-row',
      data: { label: t('settings.account.timeZone.label'), help: t('settings.account.timeZone.help'), origin: null } satisfies ComposantData<
        typeof SettingRow
      >,
      children: [
        {
          tag: 'cd-select',
          data: {
            name: 'timeZone',
            label: t('settings.account.timeZone.select'),
            value: settings.timeZone,
            options,
            help: null,
            state: null,
          } satisfies ComposantData<typeof Select>,
        },
      ],
    },
  ]);
};

type RolesData = ComposantData<typeof RoleSettings>;

/** The page's own state of « Rôles et modèles » (`role-settings.ts`): the Dialog « Nouveau Rôle », each row's error from the server. */
export interface RolesLocal {
  readonly adding: RolesData['adding'];
  readonly errors: Readonly<Record<string, string>>;
}

export const NO_ROLES_LOCAL: RolesLocal = { adding: { open: false, busy: false, nameError: null, modelError: null }, errors: {} };

const modelLabel = (engine: EngineId, label: string): string => t('settings.roles.model', { engine: t(`engine.${engine}`), label });

/**
 * « Rôles et modèles » (PARAM-2, US-39): the usable models, then the four
 * default Rôles in effect (`withDefaultRoles`, as the server computes them)
 * and the Pilote's; a choice that cannot run says why (`checkRole`), unless
 * the server just refused the row, whose message comes first.
 */
const roles = (settings: AccountSettings, accounts: readonly AiAccount[], local: RolesLocal): PlacedNode => {
  const usable = usableModelsOf(accounts);
  const effective: Readonly<Record<string, RoleChoice>> = withDefaultRoles(settings.roles, accounts);
  const labelOf = (choice: NonNullable<RoleChoice>): string =>
    accounts.find((candidate) => candidate.engine === choice.engine)?.models.find((model) => model.id === choice.model)?.label ?? choice.model;
  const row = (id: string, name: string, help: string, removable: boolean): RolesData['roles'][number] => {
    const choice = Object.hasOwn(effective, id) ? (effective[id] ?? null) : null;
    const check = choice ? checkRole(id, choice, accounts) : null;
    const unusable = check && !check.usable ? t('settings.roles.unusable', { reason: t(`settings.roles.reason.${check.reason ?? 'unknown-model'}`) }) : null;
    return {
      id,
      name,
      help,
      choice: choice ? { ...choice, label: modelLabel(choice.engine, labelOf(choice)) } : null,
      error: (Object.hasOwn(local.errors, id) ? local.errors[id] : undefined) ?? unusable,
      removable,
    };
  };
  const oneEngine = new Set(usable.map((model) => model.engine)).size === 1;
  const data: RolesData = {
    models: usable.map((model) => ({ engine: model.engine, model: model.model, label: modelLabel(model.engine, model.label) })),
    roles: [
      ...AGENT_ROLES.map((role) =>
        row(role, t(`role.${role}`), t(role === 'review' && oneEngine ? 'settings.roles.help.reviewOneEngine' : `settings.roles.help.${role}`), false),
      ),
      ...settings.customRoles.map((custom) => row(custom.id, custom.name, t('settings.roles.help.custom'), true)),
    ],
    adding: local.adding,
  };
  return { tag: 'cd-role-settings', slot: 'roles', data };
};

/** What « Rôles et modèles » reads beside the settings: the Comptes IA the Runner reports, the page's own state. */
export interface RolesInput {
  readonly accounts?: readonly AiAccount[];
  readonly local?: RolesLocal;
}

/** What « Connexion » reads (CORE-11): the Pilote's Identités, and the URL's `?erreur=` after a failed « Relier GitHub ». */
export interface IdentitiesInput {
  readonly pilot?: Pick<Me, 'identities'> | null | undefined;
  readonly erreur?: string | undefined;
}

/** « Connexion », placed in `account` before « Compte »: one row per Identité, an unknown `erreur` ignored. */
const identities = (pilot: Pick<Me, 'identities'>, erreur: string | undefined): PlacedNode => {
  const error = zLinkError.safeParse(erreur);
  const data: ComposantData<typeof AccountIdentities> = { identities: pilot.identities, error: error.success ? error.data : null };
  return { tag: 'cd-account-identities', slot: 'account', data };
};

/** What the Paramètres read beside the settings: « Rôles et modèles »'s, « Connexion »'s, and the Appareils with this browser's own (E2E-3). */
export interface ParametresInput extends RolesInput, IdentitiesInput {
  readonly devices?: ReadonlyMap<string, Device>;
  readonly currentDeviceId?: string | null;
}

/**
 * The Emplacements of the Paramètres (pure, US-82): « Appareils » once the
 * snapshot gave them, this page's own named (E2E-3); once the Pilote is
 * known, « Connexion » with their Identités (CORE-11); once the snapshot gave
 * the settings, « Rôles et modèles » (PARAM-2) and « Compte » with the time
 * zone (a zone the list lacks, an alias, kept among the options), then « Pour
 * les Moddeurs ». The other sections are their tickets'.
 */
export const parametresView = (
  settings: AccountSettings | null | undefined,
  zones: readonly string[],
  { accounts = [], local = NO_ROLES_LOCAL, pilot, erreur, devices, currentDeviceId }: ParametresInput = {},
): readonly PlacedNode[] => [
  ...[devicesCard(devices, currentDeviceId)].filter((node) => node !== null),
  ...(settings ? [roles(settings, accounts, local)] : []),
  ...(pilot ? [identities(pilot, erreur)] : []),
  ...(settings ? [account(settings, zones)] : []),
  modders(),
];
