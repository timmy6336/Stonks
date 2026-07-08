import { fetchHistory } from '../api/marketData';
import { getTrades } from '../db/database';
import type { Candle, Trade } from '../types';

export type PortfolioValuePoint = { date: string; value: number };

export type PeriodChange = {
  label: string;
  startLabel: string;
  startValue: number;
  endValue: number;
  changeAmount: number;
  changePercent: number;
};

export type PortfolioPerformance = {
  points: PortfolioValuePoint[];
  periods: PeriodChange[];
};

export function dayKey(timestamp: number, unit: 'ms' | 's' = 'ms'): string {
  const ms = unit === 's' ? timestamp * 1000 : timestamp;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Reconstructs portfolio value over time by replaying trade history against
 * each symbol's historical daily open/close prices, then reports percent
 * change for a few common lookback windows. `currentPositions`/`currentPrices`
 * are used for "now" so the latest figure reflects live quotes rather than
 * the last available daily close. Pure function (no I/O) so it can be unit
 * tested without a DB or network.
 */
export function computePerformanceFromData(
  trades: Trade[],
  historyBySymbol: Map<string, Candle[]>,
  startingCash: number,
  currentCashBalance: number,
  currentPositions: { symbol: string; quantity: number }[],
  currentPrices: Record<string, number>,
  now = Date.now()
): PortfolioPerformance {
  const sortedTrades = trades.slice().sort((a, b) => a.timestamp - b.timestamp);
  const currentValue =
    currentCashBalance + currentPositions.reduce((sum, p) => sum + p.quantity * (currentPrices[p.symbol] ?? 0), 0);

  if (sortedTrades.length === 0) {
    return { points: [{ date: dayKey(now), value: currentValue }], periods: [] };
  }

  const closeBySymbolDate = new Map<string, Map<string, number>>();
  const openBySymbolDate = new Map<string, Map<string, number>>();
  let referenceDates: string[] = [];
  for (const [symbol, candles] of historyBySymbol) {
    const closeMap = new Map<string, number>();
    const openMap = new Map<string, number>();
    for (const c of candles) {
      const d = dayKey(c.time, 's');
      closeMap.set(d, c.close);
      openMap.set(d, c.open);
    }
    closeBySymbolDate.set(symbol, closeMap);
    openBySymbolDate.set(symbol, openMap);
    const dates = candles.map((c) => dayKey(c.time, 's'));
    if (dates.length > referenceDates.length) referenceDates = dates;
  }

  if (referenceDates.length === 0) {
    return { points: [{ date: dayKey(now), value: currentValue }], periods: [] };
  }

  function priceOn(symbol: string, date: string, field: 'open' | 'close'): number {
    const map = (field === 'open' ? openBySymbolDate : closeBySymbolDate).get(symbol);
    if (!map) return 0;
    if (map.has(date)) return map.get(date)!;
    let best: number | undefined;
    let bestDate = '';
    for (const [d, v] of map) {
      if (d <= date && d > bestDate) {
        bestDate = d;
        best = v;
      }
    }
    return best ?? 0;
  }

  // Replay trades forward, snapshotting portfolio value (cash + positions at that day's close) after each trading day.
  let cash = startingCash;
  const positions: Record<string, number> = {};
  let tradeIdx = 0;
  const points: PortfolioValuePoint[] = [];

  const applyOneTrade = (t: Trade) => {
    if (t.side === 'BUY') {
      cash -= t.quantity * t.price;
      positions[t.symbol] = (positions[t.symbol] ?? 0) + t.quantity;
    } else {
      cash += t.quantity * t.price;
      positions[t.symbol] = (positions[t.symbol] ?? 0) - t.quantity;
    }
  };

  const todayDate = dayKey(now);
  let cashAtStartOfToday = startingCash;
  const positionsAtStartOfToday: Record<string, number> = {};
  let recordedStartOfToday = false;

  for (const date of referenceDates) {
    if (!recordedStartOfToday && date >= todayDate) {
      cashAtStartOfToday = cash;
      Object.assign(positionsAtStartOfToday, positions);
      recordedStartOfToday = true;
    }
    while (tradeIdx < sortedTrades.length && dayKey(sortedTrades[tradeIdx].timestamp) <= date) {
      applyOneTrade(sortedTrades[tradeIdx]);
      tradeIdx++;
    }
    let value = cash;
    for (const [symbol, qty] of Object.entries(positions)) {
      if (qty <= 0) continue;
      value += qty * priceOn(symbol, date, 'close');
    }
    points.push({ date, value });
  }
  if (!recordedStartOfToday) {
    cashAtStartOfToday = cash;
    Object.assign(positionsAtStartOfToday, positions);
  }
  while (tradeIdx < sortedTrades.length) {
    applyOneTrade(sortedTrades[tradeIdx]);
    tradeIdx++;
  }

  if (points.length > 0 && points[points.length - 1].date === todayDate) {
    points[points.length - 1] = { date: todayDate, value: currentValue };
  } else {
    points.push({ date: todayDate, value: currentValue });
  }

  let todayOpenValue = cashAtStartOfToday;
  for (const [symbol, qty] of Object.entries(positionsAtStartOfToday)) {
    if (qty <= 0) continue;
    todayOpenValue += qty * priceOn(symbol, todayDate, 'open');
  }

  function valueAsOf(targetDate: string): number | null {
    let best: number | null = null;
    for (const p of points) {
      if (p.date <= targetDate) best = p.value;
      else break;
    }
    return best;
  }

  function periodChange(label: string, daysBack: number): PeriodChange | null {
    const target = dayKey(now - daysBack * 86_400_000);
    const startValue = valueAsOf(target);
    if (startValue == null || startValue <= 0) return null;
    return {
      label,
      startLabel: `${daysBack}d ago (${target})`,
      startValue,
      endValue: currentValue,
      changeAmount: currentValue - startValue,
      changePercent: ((currentValue - startValue) / startValue) * 100,
    };
  }

  const periods: PeriodChange[] = [];
  if (todayOpenValue > 0) {
    periods.push({
      label: 'Today',
      startLabel: "Today's open",
      startValue: todayOpenValue,
      endValue: currentValue,
      changeAmount: currentValue - todayOpenValue,
      changePercent: ((currentValue - todayOpenValue) / todayOpenValue) * 100,
    });
  }
  const p7 = periodChange('7D', 7);
  if (p7) periods.push(p7);
  const p30 = periodChange('30D', 30);
  if (p30) periods.push(p30);

  return { points, periods };
}

/** Fetches trade history + per-symbol daily price history, then delegates to computePerformanceFromData. */
export async function computePortfolioPerformance(
  profileId: number,
  startingCash: number,
  currentCashBalance: number,
  currentPositions: { symbol: string; quantity: number }[],
  currentPrices: Record<string, number>
): Promise<PortfolioPerformance> {
  const trades = await getTrades('PAPER', profileId);
  const symbols = Array.from(new Set(trades.map((t) => t.symbol)));

  const historyBySymbol = new Map<string, Candle[]>();
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        historyBySymbol.set(symbol, await fetchHistory(symbol, '6mo', '1d'));
      } catch {
        historyBySymbol.set(symbol, []);
      }
    })
  );

  return computePerformanceFromData(trades, historyBySymbol, startingCash, currentCashBalance, currentPositions, currentPrices);
}
