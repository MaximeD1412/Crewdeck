const TICKET_BRANCH = /^(feat|fix|chore)\/([1-9][0-9]{0,9})-[a-z0-9-]+$/;

/**
 * The Ticket a change of code delivers, read from its head branch
 * (`feat/42-connexion-github` → 42) and nothing else: the server never reads
 * a PR's body. Null for any other branch.
 */
export const ticketNumberOfBranch = (branch: string): number | null => {
  const number = TICKET_BRANCH.exec(branch)?.[2];
  return number === undefined ? null : Number(number);
};
