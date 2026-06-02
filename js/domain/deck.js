// Domain: the card deck and vote value rules. Pure, no side effects.

export const DECK = [0, 1, 2, 3, 5, 8, 13, 21, '?'];

export function isNumericVote(value) {
  return typeof value === 'number';
}
