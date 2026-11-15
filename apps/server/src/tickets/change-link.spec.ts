import { ticketNumberOfBranch } from './change-link.js';

describe('ticketNumberOfBranch', () => {
  it.each([
    ['feat/42-connexion-github', 42],
    ['fix/7-a', 7],
    ['chore/58-boucle-1-tickets', 58],
  ])('reads %s as the Ticket %i', (branch, number) => {
    expect(ticketNumberOfBranch(branch)).toBe(number);
  });

  it.each(['main', 'develop', 'feat/connexion', 'feat/42', 'feat/42-Connexion', 'docs/42-x', 'feat/0-x', 'user/feat/42-x', 'feat/42-x/y'])(
    'gives no Ticket for %s',
    (branch) => {
      expect(ticketNumberOfBranch(branch)).toBeNull();
    },
  );
});
