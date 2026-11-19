import {
  AGENT_ROLES,
  BRANCH_NAME_MAX,
  checkRole,
  usableModelsOf,
  withDefaultRoles,
  WORKTREE_COMMAND_MAX,
  type AiAccount,
  type Project,
  type ProjectSettings,
  type ProjectSettingsSection,
  type RoleChoice,
  type SettingOrigin,
  type SettingsState,
} from '@crewdeck/contracts';
import {
  t,
  type ComposantData,
  type PageParametresProjet,
  type Select,
  type SettingRow,
  type TextField,
  type Toggle,
} from '@crewdeck/sdk';
import type { PlacedNode } from '../placed.js';
import { card, linkRow, modelLabel } from './parametres.js';

/**
 * Where the page stands with the Projet's sealed worktree Commandes:
 * `locked` while the vault is (a browser that is no trusted Appareil),
 * `opening` meanwhile, `open` with their texts (`''` for none), `unreadable`
 * when the stored item does not open with this vault.
 */
export type WorktreeLocal =
  | { readonly state: 'locked' | 'opening' | 'unreadable' }
  | { readonly state: 'open'; readonly prepare: string; readonly clean: string };

/** The page's own state of a Projet's Paramètres (`project-settings.ts`): what the store does not hold. */
export interface ProjectSettingsLocal {
  /** Each control's refusal from the server, by its `name`. */
  readonly errors: Readonly<Record<string, string>>;
  /** A text typed and not stored yet (on its way, or refused), by its control's `name`: shown in place of the stored one. */
  readonly drafts: Readonly<Record<string, string>>;
  readonly worktree: WorktreeLocal;
}

export const NO_PROJECT_SETTINGS_LOCAL: ProjectSettingsLocal = { errors: {}, drafts: {}, worktree: { state: 'locked' } };

export interface ParametresProjetInput {
  readonly project: Project;
  /** The `settings` slice: the account's, and each Projet's (a Projet not there yet changed nothing). */
  readonly settings: SettingsState;
  readonly accounts: readonly AiAccount[];
  readonly local?: ProjectSettingsLocal;
  /** The Gestion du process of the Projet, once a route draws it (PROCESS-7): `null` until then, the row shown without its link. */
  readonly processHref?: string | null;
}

export interface ParametresProjetView {
  readonly data: ComposantData<typeof PageParametresProjet>;
  readonly slots: readonly PlacedNode[];
}

type Choice = NonNullable<RoleChoice>;

const choiceValue = (choice: Choice): string => `${choice.engine}:${choice.model}`;

/** The account's Rôles with the Projet's over them, then the defaults computed after (PARAM-2's, as `SettingsService.effective`). */
const effectiveRoles = (settings: SettingsState, own: ProjectSettings | undefined, accounts: readonly AiAccount[]) => {
  const merged: Record<string, RoleChoice> = { ...settings.roles };
  for (const id of Object.keys(merged)) {
    if (own?.origins.roles[id] === 'projet') merged[id] = own.effective.roles[id] ?? null;
  }
  return withDefaultRoles(merged as SettingsState['roles'], accounts);
};

const roles = (settings: SettingsState, own: ProjectSettings | undefined, accounts: readonly AiAccount[], local: ProjectSettingsLocal) => {
  const usable = usableModelsOf(accounts);
  const effective = effectiveRoles(settings, own, accounts);
  const oneEngine = new Set(usable.map((model) => model.engine)).size === 1;
  const labelOf = (choice: Choice): string =>
    accounts.find((candidate) => candidate.engine === choice.engine)?.models.find((model) => model.id === choice.model)?.label ?? choice.model;
  const row = (id: string, label: string, help: string | null) => {
    const name = `role:${id}`;
    const origin: SettingOrigin = own?.origins.roles[id] ?? 'compte';
    const choice = (Object.hasOwn(effective, id) ? effective[id] : null) ?? null;
    const check = choice ? checkRole(id, choice, accounts) : null;
    const unusable = check && !check.usable ? t('settings.roles.unusable', { reason: t(`settings.roles.reason.${check.reason ?? 'unknown-model'}`) }) : undefined;
    const options = usable.map((model) => ({ value: choiceValue({ engine: model.engine, model: model.model }), label: modelLabel(model.engine, model.label), disabled: false }));
    // A choice no longer usable stays the value shown, said under the field, never offered again.
    if (choice && !options.some((option) => option.value === choiceValue(choice))) {
      options.push({ value: choiceValue(choice), label: modelLabel(choice.engine, labelOf(choice)), disabled: true });
    }
    if (options.length === 0) options.push({ value: '', label: t('settings.roles.noModel'), disabled: true });
    const error = (Object.hasOwn(local.errors, name) ? local.errors[name] : undefined) ?? unusable;
    return {
      origin,
      node: {
        tag: 'cd-setting-row',
        data: { label, help, origin, name } satisfies ComposantData<typeof SettingRow>,
        children: [
          {
            tag: 'cd-select',
            data: {
              name,
              label: t('settings.roles.select', { name: label }),
              value: choice ? choiceValue(choice) : '',
              options,
              help: null,
              ...(error ? { error } : {}),
              state: usable.length === 0 ? 'disabled' : null,
            } satisfies ComposantData<typeof Select>,
          },
        ],
      } satisfies PlacedNode,
    };
  };
  const rows = [
    ...AGENT_ROLES.map((role) =>
      row(role, t(`role.${role}`), role === 'review' ? t(oneEngine ? 'settings.roles.help.reviewOneEngine' : 'settings.project.roles.review.help') : null),
    ),
    ...settings.customRoles.map((custom) => row(custom.id, custom.name, null)),
  ];
  return {
    changed: rows.filter((one) => one.origin === 'projet').length,
    node: card('roles', { title: t('settings.project.roles.title'), label: t('settings.project.roles.label') }, rows.map((one) => one.node)),
  };
};

const steps = (processHref: string | null): PlacedNode =>
  card('steps', { title: t('settings.project.steps.title'), label: t('settings.project.steps.label'), flush: true }, [
    linkRow({ title: t('settings.project.steps.process'), meta: t('settings.project.steps.meta'), icon: 'layers', ...(processHref ? { href: processHref } : {}) }),
  ]);

const textRow = (
  label: string,
  help: string,
  field: Omit<ComposantData<typeof TextField>, 'label' | 'placeholder'>,
): PlacedNode => ({
  tag: 'cd-setting-row',
  data: { label, help, origin: null } satisfies ComposantData<typeof SettingRow>,
  children: [{ tag: 'cd-text-field', data: { ...field, label, placeholder: null } satisfies ComposantData<typeof TextField> }],
});

const draftOr = (local: ProjectSettingsLocal, name: string, stored: string): string =>
  (Object.hasOwn(local.drafts, name) ? local.drafts[name] : undefined) ?? stored;
const errorOf = (local: ProjectSettingsLocal, name: string): string | null => (Object.hasOwn(local.errors, name) ? (local.errors[name] ?? null) : null);

const branches = (branchesOf: ProjectSettings['branches'], local: ProjectSettingsLocal): PlacedNode => {
  const field = (branch: 'integration' | 'release') => {
    const name = `branch:${branch}`;
    return textRow(t(`settings.project.branches.${branch}`), t(`settings.project.branches.${branch}.help`), {
      name,
      value: draftOr(local, name, branchesOf[branch]),
      help: null,
      error: errorOf(local, name),
      state: null,
      multiline: false,
      maxLength: BRANCH_NAME_MAX,
    });
  };
  return card('branches', { title: t('settings.project.branches.title'), label: t('settings.project.branches.label') }, [field('integration'), field('release')]);
};

const worktree = (local: ProjectSettingsLocal): PlacedNode => {
  const { worktree: opened } = local;
  const readable = opened.state === 'open' || opened.state === 'unreadable';
  const field = (command: 'prepare' | 'clean') => {
    const name = `worktree:${command}`;
    const stored = opened.state === 'open' ? opened[command] : '';
    const unreadable = opened.state === 'unreadable' && command === 'prepare' ? t('settings.project.worktree.unreadable') : null;
    return textRow(t(`settings.project.worktree.${command}`), t(`settings.project.worktree.${command}.help`), {
      name,
      value: readable ? draftOr(local, name, stored) : '',
      help: readable ? null : t('settings.project.worktree.locked'),
      error: errorOf(local, name) ?? unreadable,
      state: readable ? null : 'disabled',
      multiline: true,
      maxLength: WORKTREE_COMMAND_MAX,
    });
  };
  return card('worktree', { title: t('settings.project.worktree.title'), label: t('settings.project.worktree.label') }, [field('prepare'), field('clean')]);
};

const notifications = (settings: SettingsState, own: ProjectSettings | undefined) => {
  const origin: SettingOrigin = own?.origins.notifications.push ?? 'compte';
  const label = t('settings.project.notifications.push');
  // The account's push off wins over the Projet's on (US-82).
  const offOnAccount = !settings.notifications.push;
  return {
    changed: origin === 'projet' ? 1 : 0,
    node: card('notifications', { title: t('settings.project.notifications.title'), label: t('settings.project.notifications.label') }, [
      {
        tag: 'cd-setting-row',
        data: {
          label,
          help: t(offOnAccount ? 'settings.project.notifications.push.offOnAccount' : 'settings.project.notifications.push.help'),
          origin,
          name: 'push',
        } satisfies ComposantData<typeof SettingRow>,
        children: [
          {
            tag: 'cd-toggle',
            data: {
              name: 'push',
              label,
              checked: !offOnAccount && (own?.effective.notifications.push ?? settings.notifications.push),
              help: null,
              state: offOnAccount ? 'disabled' : null,
            } satisfies ComposantData<typeof Toggle>,
          },
        ],
      },
    ]),
  };
};

/**
 * The Paramètres of one Projet (pure, PARAM-3, US-82, US-39): « Rôles et
 * modèles », each Rôle of the account in effect for the Projet with where it
 * comes from; « Étapes », pointing at the Gestion du process; its two
 * branches; its two worktree Commandes, read only once the vault opened
 * them; push on or off. The header counts what the Projet changed (its
 * Rôles, its push), the nav each section's. The Planifications are BOUCLE-8's.
 */
export const parametresProjetView = ({
  project,
  settings,
  accounts,
  local = NO_PROJECT_SETTINGS_LOCAL,
  processHref = null,
}: ParametresProjetInput): ParametresProjetView => {
  const own = settings.projects.find((candidate) => candidate.projectId === project.id);
  const rolesCard = roles(settings, own, accounts, local);
  const notificationsCard = notifications(settings, own);
  const counts: Partial<Record<ProjectSettingsSection, number>> = {
    ...(rolesCard.changed > 0 ? { roles: rolesCard.changed } : {}),
    ...(notificationsCard.changed > 0 ? { notifications: notificationsCard.changed } : {}),
  };
  return {
    data: { project: project.displayName, changedCount: rolesCard.changed + notificationsCard.changed, counts },
    slots: [
      rolesCard.node,
      steps(processHref),
      branches(own?.branches ?? { integration: project.integrationBranch, release: project.releaseBranch }, local),
      worktree(local),
      notificationsCard.node,
    ],
  };
};

/** `/projets/:id/parametres` for a Projet. */
export const parametresProjetHref = (projectId: string): string => `/projets/${encodeURIComponent(projectId)}/parametres`;
