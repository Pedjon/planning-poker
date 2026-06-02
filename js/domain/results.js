// Domain: round result calculation. Pure function over participants.
import { isNumericVote } from './deck.js';

const EMPTY = { average: '-', consensus: '-' };

// Computes the average and consensus of the numeric votes cast.
// `consensus` is the shared value when everyone who voted picked the same
// number, otherwise 'No'. Non-numeric votes (e.g. '?') are ignored.
export function computeResults(participants) {
  const nums = participants
    .filter((p) => p.hasVoted && isNumericVote(p.vote))
    .map((p) => p.vote);

  if (!nums.length) return { ...EMPTY };

  const sum = nums.reduce((a, b) => a + b, 0);
  const average = (sum / nums.length).toFixed(1).replace(/\.0$/, '');
  const allEqual = nums.every((n) => n === nums[0]);

  return { average, consensus: allEqual ? String(nums[0]) : 'No' };
}
