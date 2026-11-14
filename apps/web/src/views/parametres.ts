import type { AccountSettings } from '@crewdeck/contracts';
import { t, type Card, type ComposantData, type Icon, type ListRow, type Select, type SettingRow } from '@crewdeck/sdk';
import type { PlacedNode } from '../placed.js';

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

/**
 * The Emplacements of the Paramètres (pure, US-82): « Compte » with the time
 * zone once the snapshot gave the settings (a zone the list lacks, an alias,
 * kept among the options), then « Pour les Moddeurs ». The other sections are
 * their tickets'.
 */
export const parametresView = (settings: AccountSettings | null | undefined, zones: readonly string[]): readonly PlacedNode[] => [
  ...(settings ? [account(settings, zones)] : []),
  modders(),
];
