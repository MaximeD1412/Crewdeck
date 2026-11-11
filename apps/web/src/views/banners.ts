import { formatHour, t, type Banner, type ComposantData } from '@crewdeck/sdk';
import type { StoreState } from '../store/store.js';

export type BannerData = ComposantData<typeof Banner>;

/** One Banner of the Cadre's `banner` Emplacement: its data, and the text of its default Emplacement. */
export interface BannerView {
  /** Which banner it is, the same element kept from one state to the next. */
  readonly key: 'resync' | 'error';
  readonly data: BannerData;
  readonly text: string | null;
}

/**
 * The core's Banners above the page (pure): the Resynchronisation's while the
 * page lost the state and is not `live` again (ADR 0007), the time of the
 * loss in its text; then the API error no caller handled, its `message` as
 * is (ADR 0008). The first boot, before any loss, shows none.
 */
export const bannersView = (state: Pick<StoreState, 'connection' | 'lostAt'>, error: string | null): readonly BannerView[] => {
  const banners: BannerView[] = [];
  if (state.connection !== 'live' && state.lostAt) {
    banners.push({
      key: 'resync',
      data: { tone: 'caution', title: t('resync.title'), icon: 'refresh' },
      text: t('resync.body', { time: formatHour(state.lostAt) }),
    });
  }
  if (error !== null) banners.push({ key: 'error', data: { tone: 'halt', title: error, icon: 'alert' }, text: null });
  return banners;
};
