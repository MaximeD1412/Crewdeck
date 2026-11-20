import { t } from '@crewdeck/sdk';

/** The words of an impact or an effort (US-6). */
export type RatingWord = 'faible' | 'moyen' | 'fort';

/** A figure from 1 to 5 as a word: 1 and 2 « faible », 3 « moyen », 4 and 5 « fort ». */
export const ratingWord = (rating: number): RatingWord => (rating <= 2 ? 'faible' : rating === 3 ? 'moyen' : 'fort');

/** The word of `rating`, in the page's copy. */
export const ratingLabel = (rating: number): string => t(`idees.analyse.rating.${ratingWord(rating)}`);

/** The word of `rating` and its reason: « moyen : le client le demande ». */
export const ratingReason = (rating: number, why: string): string => t('idees.analyse.reason', { rating: ratingLabel(rating), why });
