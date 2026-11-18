import { DEFAULT_ACCOUNT_SETTINGS, type AccountSettings, type AiAccount, type PushSubscription } from '@crewdeck/contracts';
import { t, type ComposantData, type PushSettings, type RoleSettings } from '@crewdeck/sdk';
import type { PlacedNode } from '../placed.js';
import { devicesCard } from './devices.js';
import { NO_PUSH_LOCAL, NO_ROLES_LOCAL, parametresView, type PushLocal } from './parametres.js';

const SETTINGS = { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Asia/Tokyo' };
const ZONES = ['America/Montreal', 'Asia/Tokyo', 'Europe/Paris'];

const MODDERS = {
  tag: 'cd-card',
  slot: 'modders',
  data: { title: t('settings.modders.title'), label: t('settings.modders.label'), flush: true },
  children: [
    {
      tag: 'cd-list-row',
      data: { title: t('settings.modders.library.title'), meta: t('settings.modders.library.meta'), icon: 'layers', href: '/parametres/composants' },
      // The chevron of a row that leads to a page, as the mockup draws it.
      children: [{ tag: 'cd-icon', slot: 'trailing', data: { name: 'chevron-right', size: 'sm' } }],
    },
  ],
};

describe('parametresView', () => {
  it('fills « Compte » with the time zone, every IANA zone to pick, and « Pour les Moddeurs »', () => {
    expect(parametresView(SETTINGS, ZONES).filter((node) => node.slot === 'account' || node.slot === 'modders')).toEqual([
      {
        tag: 'cd-card',
        slot: 'account',
        data: { title: t('settings.account.title'), label: t('settings.account.label') },
        children: [
          {
            tag: 'cd-setting-row',
            data: { label: t('settings.account.timeZone.label'), help: t('settings.account.timeZone.help'), origin: null },
            children: [
              {
                tag: 'cd-select',
                data: {
                  name: 'timeZone',
                  label: t('settings.account.timeZone.select'),
                  value: 'Asia/Tokyo',
                  options: ZONES.map((zone) => ({ value: zone, label: zone, disabled: false })),
                  help: null,
                  state: null,
                },
              },
            ],
          },
        ],
      },
      MODDERS,
    ]);
  });

  it('keeps a zone the list lacks (an alias) among the options, in its order', () => {
    const account = parametresView({ ...SETTINGS, timeZone: 'Europe/Kiev' }, ZONES).find((node) => node.slot === 'account');
    const select = account?.children?.[0]?.children?.[0]?.data as { value: string; options: { value: string }[] };
    expect(select.value).toBe('Europe/Kiev');
    expect(select.options.map((option) => option.value)).toEqual(['America/Montreal', 'Asia/Tokyo', 'Europe/Kiev', 'Europe/Paris']);
  });

  it('shows only « Pour les Moddeurs » until the snapshot gives the settings', () => {
    expect(parametresView(undefined, ZONES)).toEqual([MODDERS]);
    expect(parametresView(null, ZONES)).toEqual([MODDERS]);
  });

  it('puts « Appareils » first once the snapshot gave the Appareils', () => {
    const devices = new Map([
      ['dev_1', { id: 'dev_1', name: 'Firefox sur Linux', state: 'trusted', approvedAt: '2026-11-03T09:00:00.000Z', revokedAt: null, lastSeenAt: null, current: true }],
    ] as const);
    const nodes = parametresView(SETTINGS, ZONES, { devices });
    expect(nodes.map((node) => node.slot)).toEqual(['devices', 'roles', 'notifications', 'account', 'modders']);
    expect(nodes[0]).toEqual(devicesCard(devices));
    expect(parametresView(SETTINGS, ZONES).map((node) => node.slot)).toEqual(['roles', 'notifications', 'account', 'modders']);
  });
});

const account = (engine: AiAccount['engine'], models: AiAccount['models'], overrides: Partial<AiAccount> = {}): AiAccount => ({
  id: engine === 'codex' ? '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b02' : '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01',
  engine,
  installed: true,
  version: '1.0.0',
  knownVersion: true,
  kind: 'subscription',
  state: 'connected',
  models,
  reportedAt: '2026-11-11T08:30:00.000Z',
  ...overrides,
});

const CLAUDE = account('claude-code', [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', usable: false, reason: 'not-in-plan' },
]);
const CODEX = account('codex', [
  { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', usable: false, reason: 'quota-reached' },
  { id: 'gpt-5.5', label: 'GPT-5.5', usable: true },
]);
const OPUS = { engine: 'claude-code', model: 'claude-opus-5-5', label: 'Claude Code · Opus 5.5' };
const GPT = { engine: 'codex', model: 'gpt-5.5', label: 'Codex · GPT-5.5' };
const CUSTOM = { id: 'r-k3v9q2m7', name: 'Revue Codex', createdAt: '2026-11-11T08:30:00.000Z' };

type Data = ComposantData<typeof RoleSettings>;
const rolesOf = (settings: AccountSettings, accounts: readonly AiAccount[], local = NO_ROLES_LOCAL): Data => {
  const node = parametresView(settings, ZONES, { accounts, local }).find((candidate: PlacedNode) => candidate.slot === 'roles');
  expect(node?.tag).toBe('cd-role-settings');
  return node?.data as Data;
};
const choices = (data: Data) => Object.fromEntries(data.roles.map((role) => [role.id, role.choice?.label ?? null]));

describe('parametresView, « Rôles et modèles »', () => {
  it('offers the usable models, « <Moteur> · <model> », and gives each default Rôle its name, its help, its effective model', () => {
    const data = rolesOf(SETTINGS, [CLAUDE, CODEX]);
    expect(data.models).toEqual([OPUS, GPT]);
    expect(data.roles).toEqual([
      { id: 'idea', name: 'Idée', help: 'Analyse chaque Idée notée.', choice: OPUS, error: null, removable: false },
      { id: 'design', name: 'Conception', help: 'PRD, maquettes et conception technique, avec toi.', choice: OPUS, error: null, removable: false },
      { id: 'code', name: 'Code', help: 'Implémente les Tickets dans la Boucle.', choice: OPUS, error: null, removable: false },
      {
        id: 'review',
        name: 'Review',
        help: 'Relit chaque changement de code. Par défaut sur un autre Moteur que le Code.',
        choice: GPT,
        error: null,
        removable: false,
      },
    ]);
    expect(data.adding).toEqual({ open: false, busy: false, nameError: null, modelError: null });
  });

  it('with only Codex usable, puts every default Rôle on it and says so in the Review’s help', () => {
    const data = rolesOf(SETTINGS, [{ ...CLAUDE, state: 'login-required' }, CODEX]);
    expect(choices(data)).toEqual({ idea: GPT.label, design: GPT.label, code: GPT.label, review: GPT.label });
    expect(data.roles.find((role) => role.id === 'review')?.help).toBe('Un seul Moteur disponible : la Review tourne sur le même Moteur que le Code.');
  });

  it('keeps a stored model no longer usable, labelled as its Moteur reports it, with the reason as its error', () => {
    const data = rolesOf({ ...SETTINGS, roles: { ...SETTINGS.roles, review: { engine: 'codex', model: 'gpt-5.5-pro' } } }, [CLAUDE, CODEX]);
    expect(data.roles.find((role) => role.id === 'review')).toMatchObject({
      choice: { engine: 'codex', model: 'gpt-5.5-pro', label: 'Codex · GPT-5.5 Pro' },
      error: 'Quota atteint : choisis un autre modèle.',
    });
    const gone = rolesOf({ ...SETTINGS, roles: { ...SETTINGS.roles, code: { engine: 'codex', model: 'gpt-4' } } }, [CLAUDE]);
    expect(gone.roles.find((role) => role.id === 'code')).toMatchObject({
      choice: { engine: 'codex', model: 'gpt-4', label: 'Codex · gpt-4' },
      error: 'Moteur absent du Runner : choisis un autre modèle.',
    });
  });

  it('lists the Rôles the Pilote added after the default ones, removable, with their own help', () => {
    const settings = { ...SETTINGS, roles: { ...SETTINGS.roles, [CUSTOM.id]: { engine: 'codex', model: 'gpt-5.5' } }, customRoles: [CUSTOM] } as AccountSettings;
    expect(rolesOf(settings, [CLAUDE, CODEX]).roles.at(-1)).toEqual({
      id: CUSTOM.id,
      name: 'Revue Codex',
      help: 'Un Rôle à toi : nomme-le dans une Étape de la Gestion du process.',
      choice: GPT,
      error: null,
      removable: true,
    });
  });

  it('gives the page’s own state: the Dialog « Nouveau Rôle », a row’s error from the server first', () => {
    const settings = { ...SETTINGS, roles: { ...SETTINGS.roles, review: { engine: 'codex' as const, model: 'gpt-5.5-pro' } } };
    const local = { adding: { open: true, busy: true, nameError: 'Un Rôle porte déjà ce nom.', modelError: null }, errors: { review: 'Ce modèle n’est pas utilisable sur ton Runner.' } };
    const data = rolesOf(settings, [CLAUDE, CODEX], local);
    expect(data.adding).toEqual(local.adding);
    expect(data.roles.find((role) => role.id === 'review')?.error).toBe('Ce modèle n’est pas utilisable sur ton Runner.');
  });

  it('without any usable model, offers none and leaves each default Rôle without one', () => {
    const data = rolesOf(SETTINGS, []);
    expect(data.models).toEqual([]);
    expect(choices(data)).toEqual({ idea: null, design: null, code: null, review: null });
    expect(data.roles.every((role) => role.error === null)).toBe(true);
  });
});

const IPHONE: PushSubscription = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01',
  endpoint: 'https://web.push.apple.com/QGx1',
  label: 'Safari · iPhone',
  createdAt: '2026-11-03T09:00:00.000Z',
};
const LAPTOP: PushSubscription = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02',
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  label: 'Chrome · Windows',
  createdAt: '2026-11-12T09:00:00.000Z',
};
const HERE: PushLocal = { ...NO_PUSH_LOCAL, available: true };

const pushOf = (settings: AccountSettings, subscriptions: readonly PushSubscription[], local: PushLocal = HERE): ComposantData<typeof PushSettings> => {
  const node = parametresView(settings, ZONES, { push: { subscriptions, local } }).find((candidate) => candidate.slot === 'notifications');
  expect(node?.tag).toBe('cd-push-settings');
  return node?.data as ComposantData<typeof PushSettings>;
};

describe('parametresView’s « Notifications » (ATOI-4)', () => {
  it('comes second, after « Rôles et modèles », once the settings are known', () => {
    expect(parametresView(SETTINGS, ZONES).map((node) => node.slot)).toEqual(['roles', 'notifications', 'account', 'modders']);
  });

  it('gives the account’s push and every browser that receives it, in the order they were authorized, with its date', () => {
    expect(pushOf({ ...SETTINGS, notifications: { push: true } }, [LAPTOP, IPHONE])).toEqual({
      push: true,
      subscriptions: [
        { id: IPHONE.id, label: 'Safari · iPhone', meta: 'autorisé le 3 nov.' },
        { id: LAPTOP.id, label: 'Chrome · Windows', meta: 'autorisé le 12 nov.' },
      ],
      device: 'subscribe',
      busy: false,
      error: null,
    });
    expect(pushOf(SETTINGS, []).push).toBe(SETTINGS.notifications.push);
  });

  it('says whether this browser receives them: subscribed when its endpoint is listed, unavailable where it cannot push', () => {
    expect(pushOf(SETTINGS, [IPHONE], { ...HERE, endpoint: IPHONE.endpoint }).device).toBe('subscribed');
    expect(pushOf(SETTINGS, [IPHONE], { ...HERE, endpoint: LAPTOP.endpoint }).device).toBe('subscribe');
    expect(pushOf(SETTINGS, [IPHONE], NO_PUSH_LOCAL).device).toBe('unavailable');
  });

  it('gives the account’s push on its way rather than the store’s, until the store has it', () => {
    expect(pushOf({ ...SETTINGS, notifications: { push: false } }, [], { ...HERE, pushing: true }).push).toBe(true);
    expect(pushOf({ ...SETTINGS, notifications: { push: true } }, [], { ...HERE, pushing: null }).push).toBe(true);
    expect(pushOf({ ...SETTINGS, notifications: { push: true } }, [], { ...HERE, pushing: false }).push).toBe(false);
  });

  it('gives the page’s own state: busy while subscribing, why it failed', () => {
    expect(pushOf(SETTINGS, [], { ...HERE, busy: true, error: 'L’activation a échoué : réessaie.' })).toMatchObject({ busy: true, error: 'L’activation a échoué : réessaie.' });
  });
});
