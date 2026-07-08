import { useCallback, useEffect, useState } from 'react';
import { fetchHistory, fetchQuote } from '../api/marketData';
import { computeSignal } from '../signals/signalEngine';
import type { Quote, Signal } from '../types';

export type TickerRowData = {
  symbol: string;
  quote?: Quote;
  signal?: Signal;
  error?: string;
};

/** Fetches quote + history + signal for a list of symbols in parallel, filling rows in as each resolves. */
export function useTickerRows(symbols: string[]) {
  const [rows, setRows] = useState<TickerRowData[]>([]);
  const [loading, setLoading] = useState(false);
  const key = symbols.join(',');

  const load = useCallback(async () => {
    const list = key ? key.split(',') : [];
    setLoading(true);
    setRows(list.map((symbol) => ({ symbol })));

    await Promise.all(
      list.map(async (symbol) => {
        try {
          const [quote, history] = await Promise.all([fetchQuote(symbol), fetchHistory(symbol, '6mo', '1d')]);
          const signal = computeSignal(symbol, history);
          setRows((prev) => prev.map((r) => (r.symbol === symbol ? { symbol, quote, signal } : r)));
        } catch (e) {
          setRows((prev) => prev.map((r) => (r.symbol === symbol ? { symbol, error: (e as Error).message } : r)));
        }
      })
    );
    setLoading(false);
  }, [key]);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, loading, reload: load };
}
