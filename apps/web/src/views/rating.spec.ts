import { ratingLabel, ratingReason, ratingWord } from './rating.js';

describe('the words of an impact or an effort', () => {
  it.each([
    [1, 'faible'],
    [2, 'faible'],
    [3, 'moyen'],
    [4, 'fort'],
    [5, 'fort'],
  ] as const)('says %i « %s »', (rating, word) => {
    expect(ratingWord(rating)).toBe(word);
    expect(ratingLabel(rating)).toBe(word);
  });

  it('gives the word with its reason', () => {
    expect(ratingReason(3, 'le client le demande à chaque fin de semaine')).toBe('moyen : le client le demande à chaque fin de semaine');
  });
});
