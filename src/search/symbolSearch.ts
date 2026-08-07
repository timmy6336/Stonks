import { fetchAllListedSymbols, searchSymbols, type SymbolSearchResult } from '../api/marketData';
import { getAppStateValue, getListedSymbolsCount, replaceListedSymbols, searchListedSymbols, setAppStateValue } from '../db/database';

const LAST_REFRESHED_KEY = 'listed_symbols_last_refreshed';
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // the exchange directory barely changes day to day

/**
 * Best-effort: refreshes the full US-listed-symbol master list (NASDAQ + NYSE/NYSE American/ARCA)
 * from NASDAQ's own public directory files at most once a day, so search/discovery covers the
 * whole US market rather than just what Yahoo's own search or a handful of curated/trending lists
 * happen to surface. Safe to call on every app start — it no-ops unless the cache is stale.
 */
export async function refreshListedSymbolsIfStale(): Promise<void> {
  const [lastRefreshed, count] = await Promise.all([getAppStateValue(LAST_REFRESHED_KEY), getListedSymbolsCount()]);
  const isStale = !lastRefreshed || Date.now() - Number(lastRefreshed) > REFRESH_INTERVAL_MS;
  if (!isStale && count > 0) return;

  const rows = await fetchAllListedSymbols();
  if (rows.length === 0) return; // don't wipe out a working cache just because this fetch came back empty
  await replaceListedSymbols(rows);
  await setAppStateValue(LAST_REFRESHED_KEY, String(Date.now()));
}

/**
 * Symbol/company-name search across both Yahoo's live search and the full local market directory —
 * together these cover everything Yahoo's own search surfaces plus any US-listed ticker it might
 * miss (the local directory is a complete, several-thousand-symbol index; Yahoo's search adds
 * fuzzier company-name matching and non-US-listed results the directory doesn't have).
 */
export async function searchAllSymbols(query: string, limit = 8): Promise<SymbolSearchResult[]> {
  const [yahooResults, localResults] = await Promise.all([
    searchSymbols(query, limit).catch(() => [] as SymbolSearchResult[]),
    searchListedSymbols(query, limit).catch(() => []),
  ]);
  const seen = new Set(yahooResults.map((r) => r.symbol));
  const merged = [...yahooResults];
  for (const r of localResults) {
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    merged.push({ symbol: r.symbol, name: r.name, exchange: r.exchange });
  }
  return merged.slice(0, limit);
}
