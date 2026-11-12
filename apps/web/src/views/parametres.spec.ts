import { DEFAULT_ACCOUNT_SETTINGS } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import { devicesCard } from './devices.js';
import { parametresView } from './parametres.js';

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
    expect(parametresView(SETTINGS, ZONES)).toEqual([
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
    const [account] = parametresView({ ...SETTINGS, timeZone: 'Europe/Kiev' }, ZONES);
    const select = account?.children?.[0]?.children?.[0]?.data as { value: string; options: { value: string }[] };
    expect(select.value).toBe('Europe/Kiev');
    expect(select.options.map((option) => option.value)).toEqual(['America/Montreal', 'Asia/Tokyo', 'Europe/Kiev', 'Europe/Paris']);
  });

  it('shows only « Pour les Moddeurs » until the snapshot gives the settings', () => {
    expect(parametresView(undefined, ZONES)).toEqual([MODDERS]);
    expect(parametresView(null, ZONES)).toEqual([MODDERS]);
  });

  it('puts « Appareils » before « Compte » once the snapshot gave the Appareils', () => {
    const devices = new Map([
      ['dev_1', { id: 'dev_1', name: 'Firefox sur Linux', state: 'trusted', approvedAt: '2026-11-03T09:00:00.000Z', revokedAt: null, lastSeenAt: null, current: true }],
    ] as const);
    const nodes = parametresView(SETTINGS, ZONES, devices);
    expect(nodes.map((node) => node.slot)).toEqual(['devices', 'account', 'modders']);
    expect(nodes[0]).toEqual(devicesCard(devices));
    expect(parametresView(SETTINGS, ZONES, undefined).map((node) => node.slot)).toEqual(['account', 'modders']);
  });
});
