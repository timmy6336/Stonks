import type { Candle } from '../types';
import { computeSignal } from '../signals/signalEngine';

export type BacktestResult = {
  strategyReturnPercent: number;
  buyHoldReturnPercent: number;
  trades: number;
  winRate: number | null;
  startDate: string;
  endDate: string;
};

const MIN_HISTORY = 60;

/**
 * Replays the rule-based signal engine day-by-day over historical candles:
 * buys when the signal first turns BUY/STRONG_BUY, sells when it turns
 * SELL/STRONG_SELL, and compares the result to simply buying and holding
 * over the same window. This is what answers "does the signal actually
 * help" rather than just trusting it.
 */
export function runSignalBacktest(symbol: string, candles: Candle[]): BacktestResult | null {
  if (candles.length <= MIN_HISTORY + 5) return null;

  const startingCash = 10_000;
  let cash = startingCash;
  let shares = 0;
  let entryPrice = 0;
  let trades = 0;
  let wins = 0;
  let completedRoundTrips = 0;

  for (let i = MIN_HISTORY; i < candles.length; i++) {
    const signal = computeSignal(symbol, candles.slice(0, i + 1));
    const price = candles[i].close;

    if (shares === 0 && (signal.score === 'BUY' || signal.score === 'STRONG_BUY')) {
      shares = cash / price;
      entryPrice = price;
      cash = 0;
      trades++;
    } else if (shares > 0 && (signal.score === 'SELL' || signal.score === 'STRONG_SELL')) {
      cash = shares * price;
      if (price > entryPrice) wins++;
      completedRoundTrips++;
      shares = 0;
      trades++;
    }
  }

  const finalPrice = candles[candles.length - 1].close;
  const finalValue = cash + shares * finalPrice;
  const buyHoldStartPrice = candles[MIN_HISTORY].close;

  return {
    strategyReturnPercent: ((finalValue - startingCash) / startingCash) * 100,
    buyHoldReturnPercent: ((finalPrice - buyHoldStartPrice) / buyHoldStartPrice) * 100,
    trades,
    winRate: completedRoundTrips > 0 ? (wins / completedRoundTrips) * 100 : null,
    startDate: new Date(candles[MIN_HISTORY].time * 1000).toISOString().slice(0, 10),
    endDate: new Date(candles[candles.length - 1].time * 1000).toISOString().slice(0, 10),
  };
}
