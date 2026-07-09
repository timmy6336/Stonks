import type { SignalLogEntry } from '../db/database';
import type { SignalScore } from '../types';

const MIN_AGE_MS = 24 * 60 * 60 * 1000; // only judge a call once at least a day has passed

export type EvaluatedSignalEntry = SignalLogEntry & {
  currentPrice: number;
  returnPercent: number;
  correct: boolean | null; // null for HOLD, which makes no directional call
};

function impliesUp(score: SignalScore): boolean | null {
  if (score === 'BUY' || score === 'STRONG_BUY') return true;
  if (score === 'SELL' || score === 'STRONG_SELL') return false;
  return null;
}

/** Pairs logged signals (old enough to judge) with their current price to see if the call panned out. */
export function evaluateSignalLog(entries: SignalLogEntry[], currentPrices: Map<string, number>): EvaluatedSignalEntry[] {
  const now = Date.now();
  return entries
    .filter((e) => now - e.loggedAt >= MIN_AGE_MS && currentPrices.has(e.symbol))
    .map((e) => {
      const currentPrice = currentPrices.get(e.symbol)!;
      const returnPercent = e.price !== 0 ? ((currentPrice - e.price) / e.price) * 100 : 0;
      const direction = impliesUp(e.score);
      const correct = direction === null ? null : direction ? returnPercent > 0 : returnPercent < 0;
      return { ...e, currentPrice, returnPercent, correct };
    });
}

export type SignalScoreStats = {
  score: SignalScore;
  count: number;
  correct: number;
  callable: number; // entries where the score made a directional call (excludes HOLD)
  avgReturnPercent: number;
};

const SCORE_ORDER: SignalScore[] = ['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL'];

export function summarizeSignalTrackRecord(evaluated: EvaluatedSignalEntry[]): SignalScoreStats[] {
  return SCORE_ORDER.map((score) => {
    const forScore = evaluated.filter((e) => e.score === score);
    const callable = forScore.filter((e) => e.correct !== null);
    const correct = callable.filter((e) => e.correct).length;
    const avgReturnPercent = forScore.length
      ? forScore.reduce((sum, e) => sum + e.returnPercent, 0) / forScore.length
      : 0;
    return { score, count: forScore.length, correct, callable: callable.length, avgReturnPercent };
  }).filter((s) => s.count > 0);
}
