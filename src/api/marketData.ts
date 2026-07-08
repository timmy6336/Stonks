import type { Candle, CompanyProfile, Quote } from '../types';

const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const TRENDING_BASE = 'https://query1.finance.yahoo.com/v1/finance/trending';
const QUOTE_SUMMARY_BASE = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';

type ChartResult = {
  meta: {
    regularMarketPrice: number;
    previousClose?: number;
    chartPreviousClose?: number;
    regularMarketTime: number;
  };
  timestamp: number[];
  indicators: {
    quote: Array<{
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }>;
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

/** Daily candles over the given range, e.g. range="6mo" interval="1d". */
export async function fetchHistory(symbol: string, range = '6mo', interval = '1d'): Promise<Candle[]> {
  const result = await fetchChart(symbol, range, interval);
  const { timestamp, indicators } = result;
  const q = indicators.quote[0];
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
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? meta.regularMarketPrice;
  const price = meta.regularMarketPrice;
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
    }> | null;
    error: { code: string; description: string } | null;
  };
};

export async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const res = await fetch(`${QUOTE_SUMMARY_BASE}/${encodeURIComponent(symbol)}?modules=assetProfile`);
  if (!res.ok) {
    throw new Error(`Company profile request failed for ${symbol}: HTTP ${res.status}`);
  }
  const json: QuoteSummaryResponse = await res.json();
  const profile = json.quoteSummary.result?.[0]?.assetProfile;
  if (json.quoteSummary.error || !profile) return null;

  return {
    symbol: symbol.toUpperCase(),
    sector: profile.sector ?? null,
    industry: profile.industry ?? null,
    summary: profile.longBusinessSummary ?? null,
    website: profile.website ?? null,
    employees: profile.fullTimeEmployees ?? null,
  };
}
