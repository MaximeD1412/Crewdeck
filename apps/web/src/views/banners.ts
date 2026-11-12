import { formatHour, t, type Banner, type ComposantData } from '@crewdeck/sdk';
import type { StoreState } from '../store/store.js';

export type BannerData = ComposantData<typeof Banner>;

/** One Banner of the Cadre's `banner` Emplacement: its data, and the text of its default Emplacement. */
export interface BannerView {
  /** Which banner it is, the same element kept from one state to the next. */
  readonly key: 'resync' | 'error' | 'device';
  readonly data: BannerData;
  readonly text: string | null;
  /** The label of its one button, in its `actions` Emplacement; the Shell says which Banner's was clicked. */
  readonly action?: string;
}

export type BannersState = Pick<StoreState, 'connection' | 'lostAt'> & {
  readonly vaultState?: StoreState['vaultState'];
  readonly slices?: Pick<StoreState['slices'], 'device'>;
};

/**
 * The core's Banners above the page (pure): the Resynchronisation's while the
 * page lost the state and is not `live` again (ADR 0007), the time of the
 * loss in its text; then the API error no caller handled, its `message` as
 * is (ADR 0008); then, for a browser with no Appareil while another one
 * holds the vault, the offer to approve it (E2E-3, US-60). The first boot,
 * before any loss, shows none.
 */
export const bannersView = (state: BannersState, error: string | null): readonly BannerView[] => {
  const banners: BannerView[] = [];
  if (state.connection !== 'live' && state.lostAt) {
    banners.push({
      key: 'resync',
      data: { tone: 'caution', title: t('resync.title'), icon: 'refresh' },
      text: t('resync.body', { time: formatHour(state.lostAt) }),
    });
  }
  if (error !== null) banners.push({ key: 'error', data: { tone: 'halt', title: error, icon: 'alert' }, text: null });
  const vaultExists = [...(state.slices?.device?.values() ?? [])].some((device) => device.state === 'trusted');
  if (state.vaultState === 'no-device' && vaultExists) {
    banners.push({
      key: 'device',
      data: { tone: 'caution', title: t('devices.banner.title'), icon: 'lock' },
      text: t('devices.banner.body'),
      action: t('devices.banner.approve'),
    });
  }
  return banners;
};
