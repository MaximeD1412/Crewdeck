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
  type Project,
  type PushSubscription,
  type RoleChoice,
  type SettingsState,
} from '@crewdeck/contracts';
import {
  formatDate,
  t,
  zLinkError,
  type AccountIdentities,
  type Card,
  type ComposantData,
  type Icon,
  type ListRow,
  type PushSettings,
  type RoleSettings,
  type Select,
  type SettingRow,
} from '@crewdeck/sdk';
import type { PlacedNode } from '../placed.js';
import { devicesCard } from './devices.js';

/** The time zones the Pilote may pick: the IANA zones the browser knows. */
export const timeZones = (): readonly string[] => Intl.supportedValuesOf('timeZone');

export const card = (slot: string, data: ComposantData<typeof Card>, children: readonly PlacedNode[]): PlacedNode => ({ tag: 'cd-card', slot, data, children });

/** A ListRow, with the chevron of a row that leads to a page when it has its `href`, as the mockup draws it. */
export const linkRow = (data: ComposantData<typeof ListRow>): PlacedNode => ({
  tag: 'cd-list-row',
  data,
  ...(data.href ? { children: [{ tag: 'cd-icon', slot: 'trailing', data: { name: 'chevron-right', size: 'sm' } satisfies ComposantData<typeof Icon> }] } : {}),
});

const modders = (): PlacedNode =>
  card('modders', { title: t('settings.modders.title'), label: t('settings.modders.label'), flush: true }, [
    linkRow({ title: t('settings.modders.library.title'), meta: t('settings.modders.library.meta'), icon: 'layers', href: '/parametres/composants' }),
  ]);

/**
 * « Par Projet » (PARAM-3): each Projet by name, what it changed over the
 * account (its Rôles, its push), a link to its Paramètres; no Card without a
 * Projet.
 */
/** A Projet's name without the page's vault: its `displayName`. */
const defaultProjectName = (project: Project): string => project.displayName ?? '';

const byProject = (settings: SettingsState, projects: readonly Project[], name: (project: Project) => string): readonly PlacedNode[] => {
  if (projects.length === 0) return [];
  const sorted = [...projects].sort((a, b) => name(a).localeCompare(name(b), 'fr') || (a.fullName ?? '').localeCompare(b.fullName ?? '', 'fr'));
  return [
    card(
      'projects',
      { title: t('settings.projects.title'), label: t('settings.projects.label'), flush: true },
      sorted.map((project) => {
        const count = settings.projects.find((candidate) => candidate.projectId === project.id)?.changedCount ?? 0;
        const meta =
          count === 0 ? t('settings.projects.inherits') : t(count === 1 ? 'settings.projects.changed.one' : 'settings.projects.changed.other', { count });
        return linkRow({ title: name(project), meta, href: `/projets/${encodeURIComponent(project.id)}/parametres` });
      }),
    ),
  ];
};

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

export const modelLabel = (engine: EngineId, label: string): string => t('settings.roles.model', { engine: t(`engine.${engine}`), label });

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

/** The page's own state of « Notifications » (`push-settings.ts`): what this browser can do, its endpoint, its subscription on its way, why it failed. */
export interface PushLocal {
  /** Whether this browser can receive a push (`canPush`). */
  readonly available: boolean;
  /** The endpoint this browser receives on, `null` when it is not subscribed. */
  readonly endpoint: string | null;
  /** The account's push on its way (`PATCH /api/settings`), shown until the store has it; `null` otherwise. */
  readonly pushing: boolean | null;
  readonly busy: boolean;
  readonly error: string | null;
}

export const NO_PUSH_LOCAL: PushLocal = { available: false, endpoint: null, pushing: null, busy: false, error: null };

/** What « Notifications » reads beside the settings: the store's browsers, the page's own state. */
export interface PushInput {
  readonly subscriptions?: readonly PushSubscription[];
  readonly local?: PushLocal;
}

/**
 * « Notifications » (ATOI-4, US-18): the account's push, each browser that
 * receives it in the order it was authorized, and whether this one does (its
 * endpoint listed), may (« Activer sur cet appareil ») or cannot (the help
 * of the home screen).
 */
const notifications = (settings: AccountSettings, { subscriptions = [], local = NO_PUSH_LOCAL }: PushInput): PlacedNode => {
  const sorted = [...subscriptions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const subscribed = local.endpoint !== null && sorted.some((subscription) => subscription.endpoint === local.endpoint);
  const data: ComposantData<typeof PushSettings> = {
    push: local.pushing ?? settings.notifications.push,
    subscriptions: sorted.map(({ id, label, createdAt }) => ({ id, label, meta: t('settings.notifications.authorized', { date: formatDate(createdAt) }) })),
    device: !local.available ? 'unavailable' : subscribed ? 'subscribed' : 'subscribe',
    busy: local.busy,
    error: local.error,
  };
  return { tag: 'cd-push-settings', slot: 'notifications', data };
};

/** What the Paramètres read beside the settings: the Comptes IA the Runner reports, the page's own state of the Rôles, the Projets. */
export interface RolesInput {
  readonly accounts?: readonly AiAccount[];
  readonly local?: RolesLocal;
  readonly projects?: readonly Project[];
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

/** What the Paramètres read beside the settings: « Rôles et modèles »'s, « Notifications »' (ATOI-4), « Connexion »'s, and the Appareils with this browser's own (E2E-3). */
export interface ParametresInput extends RolesInput, IdentitiesInput {
  readonly push?: PushInput;
  readonly devices?: ReadonlyMap<string, Device>;
  readonly currentDeviceId?: string | null;
  /** A Projet's name: its `displayName`, a Local Projet's opened by the page (PROJET-6, `projects.ts`); `displayName` by default. */
  readonly projectName?: (project: Project) => string;
}

/**
 * The Emplacements of the Paramètres (pure, US-82): « Appareils » once the
 * snapshot gave them, this page's own named (E2E-3); once the Pilote is
 * known, « Connexion » with their Identités (CORE-11); once the snapshot gave
 * the settings, « Rôles et modèles » (PARAM-2), « Notifications » (ATOI-4)
 * and « Compte » with the time zone (a zone the list lacks, an alias, kept
 * among the options), « Par Projet » (PARAM-3), then « Pour les Moddeurs ».
 * The other sections are their tickets'.
 */
export const parametresView = (
  settings: SettingsState | null | undefined,
  zones: readonly string[],
  { accounts = [], local = NO_ROLES_LOCAL, push = {}, projects = [], pilot, erreur, devices, currentDeviceId, projectName = defaultProjectName }: ParametresInput = {},
): readonly PlacedNode[] => [
  ...[devicesCard(devices, currentDeviceId)].filter((node) => node !== null),
  ...(settings ? [roles(settings, accounts, local), notifications(settings, push)] : []),
  ...(pilot ? [identities(pilot, erreur)] : []),
  ...(settings ? [account(settings, zones), ...byProject(settings, projects, projectName)] : []),
  modders(),
];
