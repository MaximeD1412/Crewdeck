import { DEFAULT_ACCOUNT_SETTINGS, type AiAccount, type Project, type ProjectSettings, type SettingsState } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import type { PlacedNode } from '../placed.js';
import { NO_PROJECT_SETTINGS_LOCAL, parametresProjetHref, parametresProjetView, type ProjectSettingsLocal } from './parametres-projet.js';

const account = (engine: AiAccount['engine'], models: AiAccount['models']): AiAccount => ({
  id: engine === 'codex' ? '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b02' : '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01',
  engine,
  installed: true,
  version: '1.0.0',
  knownVersion: true,
  kind: 'subscription',
  state: 'connected',
  models,
  reportedAt: '2026-11-11T08:30:00.000Z',
});

const CLAUDE = account('claude-code', [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', usable: false, reason: 'not-in-plan' },
]);
const CODEX = account('codex', [{ id: 'gpt-5.5', label: 'GPT-5.5', usable: true }]);
const ACCOUNTS = [CLAUDE, CODEX];
const OPUS = 'claude-code:claude-opus-5-5';
const GPT = 'codex:gpt-5.5';

const PROJECT: Project = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01',
  repositoryId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01',
  owner: 'dupre',
  name: 'site-mairie',
  fullName: 'dupre/site-mairie',
  displayName: 'Site mairie',
  releaseBranch: 'main',
  integrationBranch: 'develop',
  hasCode: true,
  inventoryState: 'approved',
  accessLost: false,
  followedAt: '2026-11-11T08:30:00.000Z',
};

const ACCOUNT: SettingsState = { ...DEFAULT_ACCOUNT_SETTINGS, notifications: { push: true }, timeZone: 'Europe/Paris', projects: [] };

/** The Projet's Paramètres as the server sends them: `roles` and `push` its own over the account's. */
const own = (overrides: { roles?: Record<string, { engine: 'claude-code' | 'codex'; model: string }>; push?: boolean } = {}, rest: Partial<ProjectSettings> = {}): ProjectSettings => {
  const roles = overrides.roles ?? {};
  return {
    projectId: PROJECT.id,
    effective: { ...ACCOUNT, roles: { ...ACCOUNT.roles, ...roles }, notifications: { push: overrides.push ?? ACCOUNT.notifications.push } },
    origins: {
      roles: Object.fromEntries(Object.keys(ACCOUNT.roles).map((id) => [id, Object.hasOwn(roles, id) ? 'projet' : 'compte'])),
      notifications: { push: overrides.push === undefined ? 'compte' : 'projet' },
    },
    changedCount: Object.keys(roles).length + (overrides.push === undefined ? 0 : 1),
    branches: { integration: 'develop', release: 'main' },
    worktreeCommands: null,
    ...rest,
  };
};

const view = (settings: SettingsState, local: ProjectSettingsLocal = NO_PROJECT_SETTINGS_LOCAL, processHref: string | null = null, accounts = ACCOUNTS) =>
  parametresProjetView({ project: PROJECT, settings, accounts, local, processHref });

const card = (slots: readonly PlacedNode[], slot: string): PlacedNode => {
  const found = slots.find((node) => node.slot === slot);
  if (!found) throw new Error(`no ${slot}`);
  return found;
};
/** A section's rows: each SettingRow's data, with its control's. */
const rows = (slots: readonly PlacedNode[], slot: string) =>
  (card(slots, slot).children ?? []).map((row) => ({ row: row.data as Record<string, unknown>, control: row.children?.[0]?.data as Record<string, unknown> }));
const control = (slots: readonly PlacedNode[], slot: string, name: string) => {
  const found = rows(slots, slot).find((one) => one.control['name'] === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

describe('parametresProjetView', () => {
  it('fills its sections in the order of the mockup, each Card labelled for its region', () => {
    const { slots } = view({ ...ACCOUNT, projects: [own()] });
    expect(slots.map((node) => [node.tag, node.slot, node.data])).toEqual([
      ['cd-card', 'roles', { title: t('settings.project.roles.title'), label: t('settings.project.roles.label') }],
      ['cd-card', 'steps', { title: t('settings.project.steps.title'), label: t('settings.project.steps.label'), flush: true }],
      ['cd-card', 'branches', { title: t('settings.project.branches.title'), label: t('settings.project.branches.label') }],
      ['cd-card', 'worktree', { title: t('settings.project.worktree.title'), label: t('settings.project.worktree.label') }],
      ['cd-card', 'notifications', { title: t('settings.project.notifications.title'), label: t('settings.project.notifications.label') }],
    ]);
  });

  it('shows each Rôle in effect for the Projet with where it comes from: the Code changed to Codex, the Review then on another Moteur', () => {
    const { data, slots } = view({ ...ACCOUNT, projects: [own({ roles: { code: { engine: 'codex', model: 'gpt-5.5' } } })] });

    expect(rows(slots, 'roles').map(({ row, control: select }) => [row['label'], row['origin'], row['name'], select['value']])).toEqual([
      [t('role.idea'), 'compte', 'role:idea', OPUS],
      [t('role.design'), 'compte', 'role:design', OPUS],
      [t('role.code'), 'projet', 'role:code', GPT],
      [t('role.review'), 'compte', 'role:review', OPUS],
    ]);
    const review = control(slots, 'roles', 'role:review');
    expect(review.row['help']).toBe(t('settings.project.roles.review.help'));
    expect(review.control).toMatchObject({
      label: t('settings.roles.select', { name: t('role.review') }),
      options: [
        { value: OPUS, label: 'Claude Code · Opus 5.5', disabled: false },
        { value: GPT, label: 'Codex · GPT-5.5', disabled: false },
      ],
      state: null,
    });
    expect(data).toEqual({ project: 'Site mairie', changedCount: 1, counts: { roles: 1 } });
  });

  it('inherits every Rôle from the account for a Projet that changed none, the account’s own choice included', () => {
    const settings: SettingsState = { ...ACCOUNT, roles: { ...ACCOUNT.roles, idea: { engine: 'codex', model: 'gpt-5.5' } } };
    const { data, slots } = view({ ...settings, projects: [own()] });
    expect(control(slots, 'roles', 'role:idea')).toMatchObject({ row: { origin: 'compte' }, control: { value: GPT } });
    expect(data).toEqual({ project: 'Site mairie', changedCount: 0, counts: {} });
  });

  it('lists the Rôles the Pilote added on the account, changed or not for the Projet', () => {
    const custom = { id: 'r-k3v9q2m7', name: 'Revue Codex', createdAt: '2026-11-11T08:30:00.000Z' };
    const settings = { ...ACCOUNT, roles: { ...ACCOUNT.roles, [custom.id]: { engine: 'codex', model: 'gpt-5.5' } }, customRoles: [custom] } as SettingsState;
    const projet = own();
    const changed: ProjectSettings = {
      ...projet,
      effective: { ...projet.effective, roles: { ...settings.roles, [custom.id]: { engine: 'claude-code', model: 'claude-opus-5-5' } } },
      origins: { ...projet.origins, roles: { ...projet.origins.roles, [custom.id]: 'projet' } },
    };

    expect(control(view({ ...settings, projects: [projet] }).slots, 'roles', `role:${custom.id}`)).toMatchObject({
      row: { label: 'Revue Codex', origin: 'compte', help: null },
      control: { value: GPT },
    });
    expect(control(view({ ...settings, projects: [changed] }).slots, 'roles', `role:${custom.id}`)).toMatchObject({ row: { origin: 'projet' }, control: { value: OPUS } });
  });

  it('keeps a choice no longer usable as the value, never offered, said under the field; the server’s refusal first', () => {
    const projet = own({ roles: { code: { engine: 'claude-code', model: 'claude-fable-5-1' } } });
    const unusable = control(view({ ...ACCOUNT, projects: [projet] }).slots, 'roles', 'role:code').control;
    expect(unusable['value']).toBe('claude-code:claude-fable-5-1');
    expect(unusable['options']).toContainEqual({ value: 'claude-code:claude-fable-5-1', label: 'Claude Code · Fable 5.1', disabled: true });
    expect(unusable['error']).toBe(t('settings.roles.unusable', { reason: t('settings.roles.reason.not-in-plan') }));

    const local = { ...NO_PROJECT_SETTINGS_LOCAL, errors: { 'role:code': 'Ce modèle n’est pas utilisable sur ton Runner.' } };
    expect(control(view({ ...ACCOUNT, projects: [projet] }, local).slots, 'roles', 'role:code').control['error']).toBe('Ce modèle n’est pas utilisable sur ton Runner.');
  });

  it('without any usable model, offers none and disables each Rôle', () => {
    const select = control(view({ ...ACCOUNT, projects: [own()] }, NO_PROJECT_SETTINGS_LOCAL, null, []).slots, 'roles', 'role:code').control;
    expect(select).toMatchObject({ value: '', options: [{ value: '', label: t('settings.roles.noModel'), disabled: true }], state: 'disabled' });
  });

  it('points at the Gestion du process of the Projet for its Étapes, linked once a route draws it', () => {
    const row = (processHref: string | null) => card(view({ ...ACCOUNT, projects: [own()] }, NO_PROJECT_SETTINGS_LOCAL, processHref).slots, 'steps').children?.[0];
    const href = `/projets/${PROJECT.id}/process`;
    expect(row(href)).toEqual({
      tag: 'cd-list-row',
      data: { title: t('settings.project.steps.process'), meta: t('settings.project.steps.meta'), icon: 'layers', href },
      children: [{ tag: 'cd-icon', slot: 'trailing', data: { name: 'chevron-right', size: 'sm' } }],
    });
    expect(row(null)).toEqual({ tag: 'cd-list-row', data: { title: t('settings.project.steps.process'), meta: t('settings.project.steps.meta'), icon: 'layers' } });
  });

  it('gives its two branches, never counted, the Projet’s own before it holds any Paramètres; a text typed and a refusal on its field', () => {
    const stored = own({}, { branches: { integration: 'dev', release: 'prod' } });
    const branches = (settings: SettingsState, local = NO_PROJECT_SETTINGS_LOCAL) =>
      rows(view(settings, local).slots, 'branches').map(({ row, control: field }) => [row['label'], row['help'], row['origin'], field['name'], field['value'], field['error']]);

    expect(branches({ ...ACCOUNT, projects: [stored] })).toEqual([
      [t('settings.project.branches.integration'), t('settings.project.branches.integration.help'), null, 'branch:integration', 'dev', null],
      [t('settings.project.branches.release'), t('settings.project.branches.release.help'), null, 'branch:release', 'prod', null],
    ]);
    expect(branches(ACCOUNT).map((one) => one[4])).toEqual(['develop', 'main']);
    expect(view({ ...ACCOUNT, projects: [stored] }).data.changedCount).toBe(0);

    const local = { ...NO_PROJECT_SETTINGS_LOCAL, drafts: { 'branch:release': 'prod..x' }, errors: { 'branch:release': 'Ce nom de branche n’est pas valide.' } };
    expect(branches({ ...ACCOUNT, projects: [stored] }, local)[1]?.slice(4)).toEqual(['prod..x', 'Ce nom de branche n’est pas valide.']);
    expect(control(view({ ...ACCOUNT, projects: [stored] }).slots, 'branches', 'branch:release').control).toMatchObject({ multiline: false, maxLength: 100 });
  });

  it('keeps the worktree Commandes disabled and empty while the vault is locked, saying where to open them', () => {
    for (const state of ['locked', 'opening'] as const) {
      const fields = rows(view({ ...ACCOUNT, projects: [own()] }, { ...NO_PROJECT_SETTINGS_LOCAL, worktree: { state } }).slots, 'worktree');
      expect(fields.map(({ row, control: field }) => [row['label'], row['help'], field['name'], field['value'], field['help'], field['state']])).toEqual([
        [t('settings.project.worktree.prepare'), t('settings.project.worktree.prepare.help'), 'worktree:prepare', '', t('settings.project.worktree.locked'), 'disabled'],
        [t('settings.project.worktree.clean'), t('settings.project.worktree.clean.help'), 'worktree:clean', '', t('settings.project.worktree.locked'), 'disabled'],
      ]);
    }
  });

  it('shows the worktree Commandes the vault opened, a text typed over them, multiline', () => {
    const local: ProjectSettingsLocal = { ...NO_PROJECT_SETTINGS_LOCAL, worktree: { state: 'open', prepare: 'pnpm install', clean: '' }, drafts: { 'worktree:clean': 'rm -rf .cache' } };
    const fields = rows(view({ ...ACCOUNT, projects: [own()] }, local).slots, 'worktree').map(({ control: field }) => field);
    expect(fields.map((field) => [field['value'], field['state'], field['help'], field['error'], field['multiline'], field['maxLength']])).toEqual([
      ['pnpm install', null, null, null, true, 4000],
      ['rm -rf .cache', null, null, null, true, 4000],
    ]);
  });

  it('lets the Pilote write over worktree Commandes this Appareil cannot open, saying so', () => {
    const fields = rows(view({ ...ACCOUNT, projects: [own()] }, { ...NO_PROJECT_SETTINGS_LOCAL, worktree: { state: 'unreadable' } }).slots, 'worktree').map(({ control: field }) => field);
    expect(fields.map((field) => [field['value'], field['state'], field['error']])).toEqual([
      ['', null, t('settings.project.worktree.unreadable')],
      ['', null, null],
    ]);
  });

  it('turns push on or off for the Projet, counted once changed', () => {
    const push = (settings: SettingsState) => {
      const { data, slots } = view(settings);
      const { row, control: toggle } = control(slots, 'notifications', 'push');
      return { data, row, toggle };
    };

    expect(push({ ...ACCOUNT, projects: [own()] })).toMatchObject({
      row: { label: t('settings.project.notifications.push'), help: t('settings.project.notifications.push.help'), origin: 'compte', name: 'push' },
      toggle: { checked: true, state: null },
    });
    expect(push({ ...ACCOUNT, projects: [own({ push: false })] })).toMatchObject({
      row: { origin: 'projet' },
      toggle: { checked: false, state: null },
      data: { changedCount: 1, counts: { notifications: 1 } },
    });
  });

  it('with push off on the account, keeps the Projet’s off and disabled, whatever it changed', () => {
    const off: SettingsState = { ...ACCOUNT, notifications: { push: false } };
    const projet = own({ push: true });
    const { slots } = view({ ...off, projects: [{ ...projet, effective: { ...projet.effective, notifications: { push: false } } }] });
    expect(control(slots, 'notifications', 'push')).toMatchObject({
      row: { help: t('settings.project.notifications.push.offOnAccount'), origin: 'projet' },
      control: { checked: false, state: 'disabled' },
    });
  });

  it('gives the URL of a Projet’s Paramètres', () => {
    expect(parametresProjetHref(PROJECT.id)).toBe(`/projets/${PROJECT.id}/parametres`);
  });
});
