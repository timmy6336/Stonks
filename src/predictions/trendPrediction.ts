import type { Candle, Signal } from '../types';

export type TrendPrediction = {
  horizonDays: number;
  projectedPrice: number;
  projectedChangePercent: number;
  rSquared: number;
  direction: 'up' | 'down' | 'flat';
};

/**
 * Fits a straight line through recent closing prices (ordinary least squares)
 * and extrapolates it forward. This is a naive trend continuation, not a
 * real forecasting model — it has no idea about news, earnings, or reversals.
 */
export function computeTrendPrediction(candles: Candle[], horizonDays = 30): TrendPrediction | null {
  if (candles.length < 30) return null;

  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const meanX = (n - 1) / 2;
  const meanY = closes.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (closes[i] - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * i;
    ssRes += (closes[i] - predicted) ** 2;
    ssTot += (closes[i] - meanY) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  const lastClose = closes[n - 1];
  const projectedPrice = intercept + slope * (n - 1 + horizonDays);
  const projectedChangePercent = lastClose !== 0 ? ((projectedPrice - lastClose) / lastClose) * 100 : 0;
  const direction = projectedChangePercent > 1 ? 'up' : projectedChangePercent < -1 ? 'down' : 'flat';

  return { horizonDays, projectedPrice, projectedChangePercent, rSquared, direction };
}

/** Combines the trend projection with the rule-based signal into one plain-English suggestion. */
export function describeTrendPrediction(prediction: TrendPrediction | null, signal: Signal): string {
  if (!prediction) {
    return 'Not enough price history yet to project a trend.';
  }

  const directionText = prediction.direction === 'up' ? 'trending upward' : prediction.direction === 'down' ? 'trending downward' : 'roughly flat';
  const confidenceText = prediction.rSquared > 0.6 ? 'a fairly consistent' : prediction.rSquared > 0.3 ? 'a moderately noisy' : 'a very noisy, low-confidence';
  const changeText = `${prediction.projectedChangePercent >= 0 ? '+' : ''}${prediction.projectedChangePercent.toFixed(1)}%`;

  const agreement =
    (prediction.direction === 'up' && (signal.score === 'BUY' || signal.score === 'STRONG_BUY')) ||
    (prediction.direction === 'down' && (signal.score === 'SELL' || signal.score === 'STRONG_SELL'));
  const conflict =
    (prediction.direction === 'up' && (signal.score === 'SELL' || signal.score === 'STRONG_SELL')) ||
    (prediction.direction === 'down' && (signal.score === 'BUY' || signal.score === 'STRONG_BUY'));

  let alignmentNote = 'This is a separate, longer-horizon view than the signal above — treat them as two data points, not a combined verdict.';
  if (agreement) alignmentNote = 'This lines up with the current rule-based signal above.';
  if (conflict) alignmentNote = 'This runs against the current rule-based signal above — worth a closer look before acting either way.';

  return (
    `Over the recent history, the price has been ${directionText}, with ${confidenceText} fit to a straight line. ` +
    `If that trend simply continued in a straight line (it usually won't exactly), a naive projection puts the price around ` +
    `$${prediction.projectedPrice.toFixed(2)} in ${prediction.horizonDays} days (${changeText}). ${alignmentNote} ` +
    `This is a mechanical extrapolation, not a forecast — it knows nothing about news, earnings, or market conditions.`
  );
}
