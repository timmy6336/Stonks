import type { Candle, CompanyProfile, Quote } from '../types';

const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const TRENDING_BASE = 'https://query1.finance.yahoo.com/v1/finance/trending';
const QUOTE_SUMMARY_BASE = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';
const SEARCH_BASE = 'https://query1.finance.yahoo.com/v1/finance/search';
const SCREENER_BASE = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved';

type ChartResult = {
  meta: {
    regularMarketPrice: number;
    previousClose?: number;
    chartPreviousClose?: number;
    regularMarketTime: number;
  };
  timestamp?: number[] | null;
  indicators: {
    quote?: Array<{
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }> | null;
  };
};

type YahooChartResponse = {
  chart: {
    result: ChartResult[] | null;
    error: { code: string; description: string } | null;
  };
};

async function fetchChart(symbol: string, range: string, interval: string): Promise<ChartResult> {
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await fetch(url);
  if (res.status === 404) {
    throw new Error(`"${symbol}" isn't a recognized symbol (it may have been delisted or renamed).`);
  }
  if (!res.ok) {
    throw new Error(`Market data request failed for ${symbol}: HTTP ${res.status}`);
  }
  const json: YahooChartResponse = await res.json();
  const result = json.chart.result?.[0];
  if (json.chart.error || !result) {
    throw new Error(`No market data found for symbol "${symbol}"`);
  }
  return result;
}

/** Daily candles over the given range, e.g. range="6mo" interval="1d". Some thinly-traded symbols have no chart data for a range and come back with no timestamp/quote array at all. */
export async function fetchHistory(symbol: string, range = '6mo', interval = '1d'): Promise<Candle[]> {
  const result = await fetchChart(symbol, range, interval);
  const { timestamp, indicators } = result;
  const q = indicators.quote?.[0];
  if (!timestamp || !q) return [];
  const candles: Candle[] = [];
  for (let i = 0; i < timestamp.length; i++) {
    const close = q.close[i];
    if (close == null) continue; // skip non-trading gaps
    candles.push({
      time: timestamp[i],
      open: q.open[i] ?? close,
      high: q.high[i] ?? close,
      low: q.low[i] ?? close,
      close,
      volume: q.volume[i] ?? 0,
    });
  }
  return candles;
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  const result = await fetchChart(symbol, '5d', '1d');
  const { meta } = result;
  if (meta.regularMarketPrice == null) {
    throw new Error(`No live quote available for "${symbol}" right now.`);
  }
  const price = meta.regularMarketPrice;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
  const change = price - previousClose;
  return {
    symbol: symbol.toUpperCase(),
    price,
    previousClose,
    change,
    changePercent: previousClose !== 0 ? (change / previousClose) * 100 : 0,
    marketTime: meta.regularMarketTime,
  };
}

type TrendingResponse = {
  finance: {
    result: Array<{ quotes: Array<{ symbol: string }> }> | null;
    error: { code: string; description: string } | null;
  };
};

/** Currently trending tickers (region defaults to US). Falls back to an empty list on failure. */
export async function fetchTrendingSymbols(region = 'US', count = 15): Promise<string[]> {
  const res = await fetch(`${TRENDING_BASE}/${region}?count=${count}`);
  if (!res.ok) {
    throw new Error(`Trending stocks request failed: HTTP ${res.status}`);
  }
  const json: TrendingResponse = await res.json();
  const result = json.finance.result?.[0];
  if (json.finance.error || !result) {
    throw new Error('No trending stocks data available right now.');
  }
  return result.quotes.map((q) => q.symbol);
}

type QuoteSummaryResponse = {
  quoteSummary: {
    result: Array<{
      assetProfile?: {
        sector?: string;
        industry?: string;
        longBusinessSummary?: string;
        website?: string;
        fullTimeEmployees?: number;
      };
      summaryDetail?: {
        fiftyTwoWeekHigh?: number;
        fiftyTwoWeekLow?: number;
        volume?: number;
        averageVolume?: number;
        dividendYield?: number;
      };
      calendarEvents?: {
        earnings?: { earningsDate?: number[] };
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
};

export async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const res = await fetch(
    `${QUOTE_SUMMARY_BASE}/${encodeURIComponent(symbol)}?modules=assetProfile,summaryDetail,calendarEvents&formatted=false`
  );
  if (!res.ok) {
    throw new Error(`Company profile request failed for ${symbol}: HTTP ${res.status}`);
  }
  const json: QuoteSummaryResponse = await res.json();
  const result = json.quoteSummary.result?.[0];
  if (json.quoteSummary.error || !result) return null;

  const profile = result.assetProfile;
  const stats = result.summaryDetail;
  const earningsDate = result.calendarEvents?.earnings?.earningsDate?.[0];

  return {
    symbol: symbol.toUpperCase(),
    sector: profile?.sector ?? null,
    industry: profile?.industry ?? null,
    summary: profile?.longBusinessSummary ?? null,
    website: profile?.website ?? null,
    employees: profile?.fullTimeEmployees ?? null,
    fiftyTwoWeekHigh: stats?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: stats?.fiftyTwoWeekLow ?? null,
    volume: stats?.volume ?? null,
    averageVolume: stats?.averageVolume ?? null,
    dividendYield: stats?.dividendYield ?? null,
    nextEarningsDate: earningsDate ? earningsDate * 1000 : null,
  };
}

export type SymbolSearchResult = {
  symbol: string;
  name: string;
  exchange: string;
};

type SearchResponse = {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    exchange?: string;
  }>;
  news?: Array<{
    uuid: string;
    title: string;
    publisher: string;
    link: string;
    providerPublishTime: number;
  }>;
};

/** Company-name (or symbol) autocomplete search, so users don't need to know the exact ticker. */
export async function searchSymbols(query: string, count = 8): Promise<SymbolSearchResult[]> {
  if (!query.trim()) return [];
  const res = await fetch(`${SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=${count}&newsCount=0`);
  if (!res.ok) {
    throw new Error(`Symbol search failed: HTTP ${res.status}`);
  }
  const json: SearchResponse = await res.json();
  return (json.quotes ?? [])
    .filter((q) => q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'))
    .map((q) => ({
      symbol: q.symbol!,
      name: q.longname ?? q.shortname ?? q.symbol!,
      exchange: q.exchange ?? '',
    }));
}

export type NewsItem = {
  id: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: number;
};

/** Recent news headlines related to a symbol (via the same search endpoint Yahoo uses for its news matching). */
export async function fetchNews(symbol: string, count = 8): Promise<NewsItem[]> {
  const res = await fetch(`${SEARCH_BASE}?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=${count}`);
  if (!res.ok) {
    throw new Error(`News request failed for ${symbol}: HTTP ${res.status}`);
  }
  const json: SearchResponse = await res.json();
  return (json.news ?? []).map((n) => ({
    id: n.uuid,
    title: n.title,
    publisher: n.publisher,
    link: n.link,
    publishedAt: n.providerPublishTime * 1000,
  }));
}

type ScreenerResponse = {
  finance: {
    result: Array<{ quotes: Array<{ symbol: string }> }> | null;
    error: { code: string; description: string } | null;
  };
};

export type ScreenerId =
  | 'day_losers'
  | 'day_gainers'
  | 'most_actives'
  | 'undervalued_growth_stocks'
  | 'growth_technology_stocks'
  | 'aggressive_small_caps'
  | 'undervalued_large_caps';

/** Symbols from one of Yahoo's predefined market screeners (a much broader universe than our curated categories). */
export async function fetchScreener(scrId: ScreenerId, count = 25): Promise<string[]> {
  const res = await fetch(`${SCREENER_BASE}?formatted=false&lang=en-US&region=US&scrIds=${scrId}&count=${count}`);
  if (!res.ok) {
    throw new Error(`Screener request failed: HTTP ${res.status}`);
  }
  const json: ScreenerResponse = await res.json();
  const result = json.finance.result?.[0];
  if (json.finance.error || !result) {
    throw new Error('No screener data available right now.');
  }
  return result.quotes.map((q) => q.symbol);
}
