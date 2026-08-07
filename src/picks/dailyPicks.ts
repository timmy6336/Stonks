import { fetchHistory, fetchNews, fetchQuote, fetchScreener, fetchTrendingSymbols } from '../api/marketData';
import { computeSignal } from '../signals/signalEngine';
import { computeTrendPrediction } from '../predictions/trendPrediction';
import { generateInsight, getActiveProviderId } from '../llm/llmClient';
import { parseJsonWithRecovery } from '../llm/jsonRecovery';
import { mapWithConcurrency } from '../utils/concurrency';
import { getAppStateValue, getRandomListedSymbols, getWatchlist, setAppStateValue } from '../db/database';
import { STOCK_CATEGORIES } from '../data/categories';
import type { SignalScore } from '../types';

// The local on-device model has a small context window, so it gets a much smaller candidate set
// than a cloud provider — otherwise the prompt alone could blow past what it can even read.
const MAX_CANDIDATES_CLOUD = 60;
const MAX_CANDIDATES_LOCAL = 15;
const FETCH_CONCURRENCY = 12;
const NEWS_CONTEXT_COUNT = 15; // how many top-by-math candidates get news headlines fetched for extra AI context
const PICK_COUNT = 5;

export type DailyPick = {
  rank: number;
  symbol: string;
  price: number;
  changePercent: number;
  reasoning: string;
};

export type DailyPicksResult = {
  date: string; // YYYY-MM-DD, local calendar day this was computed for
  computedAt: number;
  maxPriceFilter: number | null; // the price cap this result was computed with, if any
  math: DailyPick[];
  mathError: string | null;
  ai: DailyPick[] | null;
  aiError: string | null;
  aiRawResponse: string | null;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const DAILY_PICKS_KEY_PREFIX = 'daily_picks_';

/** Returns today's already-computed picks, if any — never triggers new network/AI calls. */
export async function getCachedDailyPicks(): Promise<DailyPicksResult | null> {
  const raw = await getAppStateValue(DAILY_PICKS_KEY_PREFIX + todayKey());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DailyPicksResult;
  } catch {
    return null;
  }
}

/** % change from N trading days ago to the latest close, using whatever history is available. */
function pctChangeOverTradingDays(closes: number[], daysBack: number): number | null {
  const idx = closes.length - 1 - daysBack;
  if (idx < 0) return null;
  const past = closes[idx];
  const latest = closes[closes.length - 1];
  return past !== 0 ? ((latest - past) / past) * 100 : null;
}

type PickCandidateInfo = {
  symbol: string;
  price: number;
  changePercent: number;
  oneMonthChangePercent: number | null;
  threeMonthChangePercent: number | null;
  signalScore: SignalScore;
  signalPoints: number;
  reasons: string[];
  trendDirection: 'up' | 'down' | 'flat' | null;
  trendProjectedChangePercent: number | null;
  lists: string[]; // which source lists this symbol showed up on, for transparency + a small cross-confirmation bonus
  newsHeadlines?: string[];
};

/**
 * Pulls together as many free, keyless data sources as the app already has access to: the user's
 * own watchlist, currently trending symbols, today's biggest gainers/losers/most-actives, several
 * of Yahoo's other predefined screeners (value, growth-tech, small-cap momentum, large-cap value),
 * and every curated category — each candidate tagged with which of those lists it appeared on.
 */
async function gatherCandidateUniverse(maxCandidates: number): Promise<Map<string, string[]>> {
  const [watchlist, trending, gainers, losers, actives, undervaluedGrowth, growthTech, aggressiveSmallCap, undervaluedLarge, randomListed] =
    await Promise.all([
      getWatchlist().then((items) => items.map((w) => w.symbol)),
      fetchTrendingSymbols().catch(() => [] as string[]),
      fetchScreener('day_gainers', 100).catch(() => [] as string[]),
      fetchScreener('day_losers', 100).catch(() => [] as string[]),
      fetchScreener('most_actives', 100).catch(() => [] as string[]),
      fetchScreener('undervalued_growth_stocks', 100).catch(() => [] as string[]),
      fetchScreener('growth_technology_stocks', 100).catch(() => [] as string[]),
      fetchScreener('aggressive_small_caps', 100).catch(() => [] as string[]),
      fetchScreener('undervalued_large_caps', 100).catch(() => [] as string[]),
      // A random slice of the full US-listed market, so picks aren't limited to symbols already
      // popular enough to be trending/gaining/losing/on a curated list today.
      getRandomListedSymbols(30).catch(() => [] as string[]),
    ]);

  const labeledLists: [string, string[]][] = [
    ['watchlist', watchlist],
    ['trending', trending],
    ['gainers', gainers],
    ['losers', losers],
    ['most active', actives],
    ['undervalued growth', undervaluedGrowth],
    ['growth tech', growthTech],
    ['aggressive small-cap', aggressiveSmallCap],
    ['undervalued large-cap', undervaluedLarge],
    ['random sample', randomListed],
    ...STOCK_CATEGORIES.map((c): [string, string[]] => [c.name, c.symbols]),
  ];

  const bySymbol = new Map<string, string[]>();
  for (const [label, symbols] of labeledLists) {
    for (const symbol of symbols) {
      const lists = bySymbol.get(symbol);
      if (lists) lists.push(label);
      else bySymbol.set(symbol, [label]);
    }
  }

  // Cap the universe while keeping it diverse: sort by how many different lists a symbol showed
  // up on (cross-confirmation) rather than just truncating in source order.
  return new Map(
    [...bySymbol.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, maxCandidates)
  );
}

async function gatherCandidateInfo(symbolLists: Map<string, string[]>): Promise<Map<string, PickCandidateInfo>> {
  const map = new Map<string, PickCandidateInfo>();
  await mapWithConcurrency([...symbolLists.keys()], FETCH_CONCURRENCY, async (symbol) => {
    try {
      const [quote, history] = await Promise.all([fetchQuote(symbol), fetchHistory(symbol, '6mo', '1d')]);
      const signal = computeSignal(symbol, history);
      const closes = history.map((c) => c.close);
      const trend = computeTrendPrediction(history);
      map.set(symbol, {
        symbol,
        price: quote.price,
        changePercent: quote.changePercent,
        oneMonthChangePercent: pctChangeOverTradingDays(closes, 21),
        threeMonthChangePercent: pctChangeOverTradingDays(closes, 63),
        signalScore: signal.score,
        signalPoints: signal.points,
        reasons: signal.reasons.slice(0, 2),
        trendDirection: trend?.direction ?? null,
        trendProjectedChangePercent: trend?.projectedChangePercent ?? null,
        lists: symbolLists.get(symbol) ?? [],
      });
    } catch {
      // skip symbols we can't price right now rather than failing the whole batch
    }
  });
  return map;
}

/**
 * A transparent, explainable composite score — not a black box: rule-based technical signal
 * (weighted heaviest), 30-day trend projection, recent 1-month momentum (clamped so a huge recent
 * spike doesn't dominate — chasing blow-off tops is a real risk), and a small bonus for showing up
 * on multiple independent source lists at once.
 */
function computeMathScore(c: PickCandidateInfo): number {
  let score = c.signalPoints * 2;
  if (c.trendDirection === 'up' && c.trendProjectedChangePercent != null) {
    score += Math.min(c.trendProjectedChangePercent, 20) * 0.15;
  } else if (c.trendDirection === 'down' && c.trendProjectedChangePercent != null) {
    score += Math.max(c.trendProjectedChangePercent, -20) * 0.15;
  }
  if (c.oneMonthChangePercent != null) {
    score += Math.max(-30, Math.min(30, c.oneMonthChangePercent)) * 0.05;
  }
  score += c.lists.length * 0.5;
  return score;
}

function formatMathReasoning(c: PickCandidateInfo): string {
  const pct = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  const trendText = c.trendDirection ? `${c.trendDirection} trend (${pct(c.trendProjectedChangePercent)}/30d)` : 'no clear trend';
  const reasonText = c.reasons[0] ?? 'mixed technical picture';
  const listText = c.lists.length > 1 ? `; on ${c.lists.length} source lists (${c.lists.slice(0, 3).join(', ')})` : '';
  return `${c.signalScore} signal — ${reasonText}. ${trendText}, 1mo ${pct(c.oneMonthChangePercent)}${listText}.`;
}

/** Computes today's top 5 picks purely from rule-based math — no AI call involved. */
function computeMathematicalPicks(infoBySymbol: Map<string, PickCandidateInfo>): DailyPick[] {
  return [...infoBySymbol.values()]
    .map((c) => ({ c, score: computeMathScore(c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, PICK_COUNT)
    .map(({ c }, i) => ({
      rank: i + 1,
      symbol: c.symbol,
      price: c.price,
      changePercent: c.changePercent,
      reasoning: formatMathReasoning(c),
    }));
}

function formatCandidateLine(c: PickCandidateInfo): string {
  const pct = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  const trend = c.trendDirection ? `${c.trendDirection} ${pct(c.trendProjectedChangePercent)}/30d` : 'n/a';
  const listsText = c.lists.slice(0, 4).join(', ') || 'none';
  const base = `- ${c.symbol} $${c.price.toFixed(2)} (day ${pct(c.changePercent)}, 1mo ${pct(c.oneMonthChangePercent)}, 3mo ${pct(c.threeMonthChangePercent)}) sig=${c.signalScore} trend=${trend} lists: ${listsText}`;
  if (c.newsHeadlines && c.newsHeadlines.length > 0) {
    return `${base}\n  recent headlines: ${c.newsHeadlines.map((h) => `"${h}"`).join('; ')}`;
  }
  return base;
}

function buildAiPrompt(candidates: PickCandidateInfo[]): string {
  const candidatesText = candidates.map(formatCandidateLine).join('\n');
  return `You are a stock-screening component inside a paper-trading simulator app (no real money, purely educational). Your one job this round: rank the ${PICK_COUNT} most interesting symbols from the candidate list below for further research, using ONLY the data provided. This is a mechanical ranking task, not a request for personalized investment advice — always complete it in the exact format requested below, with no disclaimers, hedging, or refusal, since it only surfaces a shortlist for a human to research further, not a trade to execute.
Respond with ONLY valid JSON, no markdown fences, no commentary, no disclaimer text before or after it, in exactly this shape (this is just an example — "AAPL" is a placeholder too, always substitute a real symbol from the list below, never the literal word "TICKER" or any symbol not shown below):
{"picks": [{"symbol": "AAPL", "reasoning": "short reason grounded in the data below"}]}
Return exactly ${PICK_COUNT} picks, ranked best-first. Only use symbols from the list below. Base each reasoning on the actual data shown for that symbol (signal, trend, momentum, headlines) — don't invent facts not present below.

Candidates (day/1mo/3mo % change, signal, 30-day trend projection, which source lists it appears on, and recent headlines where available):
${candidatesText}`;
}

async function generateAiPicks(
  infoBySymbol: Map<string, PickCandidateInfo>,
  mathRanked: PickCandidateInfo[]
): Promise<{ picks: DailyPick[] | null; error: string | null; rawResponse: string | null }> {
  const activeProviderId = await getActiveProviderId();
  if (!activeProviderId) {
    return { picks: null, error: 'No AI provider configured. Add a free API key or download the local model in Settings.', rawResponse: null };
  }

  const maxCandidates = activeProviderId === 'local' ? MAX_CANDIDATES_LOCAL : MAX_CANDIDATES_CLOUD;
  // Feed the AI the full candidate set (capped for context size), enriched with recent headlines
  // for the strongest math-ranked subset — as much real information as is practical to gather.
  const candidates = mathRanked.slice(0, maxCandidates);
  const newsTargets = candidates.slice(0, Math.min(NEWS_CONTEXT_COUNT, maxCandidates));
  await mapWithConcurrency(newsTargets, FETCH_CONCURRENCY, async (c) => {
    try {
      const news = await fetchNews(c.symbol, 2);
      c.newsHeadlines = news.map((n) => n.title);
    } catch {
      // no headlines available for this symbol — the prompt just omits that line
    }
  });

  const prompt = buildAiPrompt(candidates);

  let rawResponse: string;
  try {
    rawResponse = await generateInsight(prompt);
  } catch (e) {
    return { picks: null, error: `Could not reach the AI provider: ${(e as Error).message}`, rawResponse: null };
  }

  let parsed: { picks?: unknown[] };
  try {
    // Accept either "symbol" or "ticker" as the item's identifying field — some models use one
    // name in the reply even when the prompt's example uses the other.
    parsed = parseJsonWithRecovery(rawResponse, 'picks', (obj) => 'symbol' in obj || 'ticker' in obj) as { picks?: unknown[] };
  } catch (e) {
    return { picks: null, error: `AI response could not be parsed: ${(e as Error).message}`, rawResponse };
  }

  const rawPicks = Array.isArray(parsed.picks) ? parsed.picks.slice(0, PICK_COUNT) : [];
  const picks: DailyPick[] = [];
  for (const entry of rawPicks) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const rawSymbol = typeof e.symbol === 'string' ? e.symbol : typeof e.ticker === 'string' ? e.ticker : '';
    const symbol = rawSymbol.toUpperCase();
    const info = infoBySymbol.get(symbol);
    if (!info) continue; // not a real candidate we offered — skip rather than show unverified data
    const reasoning = typeof e.reasoning === 'string' ? e.reasoning.slice(0, 300) : 'No reasoning given.';
    picks.push({ rank: picks.length + 1, symbol, price: info.price, changePercent: info.changePercent, reasoning });
  }

  if (picks.length === 0) {
    return { picks: null, error: 'The AI response did not contain any usable picks — see the raw response below.', rawResponse };
  }
  return { picks, error: null, rawResponse };
}

/**
 * Computes (and caches) today's picks: a rule-based top 5 and, if an AI provider is configured,
 * an AI-generated top 5. `maxPrice`, if given, restricts both lists to candidates trading at or
 * below that price — the AI never even sees a symbol above the cap, so it can't pick one.
 */
export async function computeDailyPicks(maxPrice?: number | null): Promise<DailyPicksResult> {
  const date = todayKey();
  const maxCandidates = MAX_CANDIDATES_CLOUD; // gather broadly once; the AI step sub-samples if a smaller model is active
  const priceCap = maxPrice != null && maxPrice > 0 ? maxPrice : null;
  let math: DailyPick[] = [];
  let mathError: string | null = null;
  let ai: DailyPick[] | null = null;
  let aiError: string | null = null;
  let aiRawResponse: string | null = null;

  try {
    const symbolLists = await gatherCandidateUniverse(maxCandidates);
    let infoBySymbol = await gatherCandidateInfo(symbolLists);
    if (infoBySymbol.size === 0) {
      mathError = 'No market data available right now.';
    } else {
      if (priceCap != null) {
        infoBySymbol = new Map([...infoBySymbol].filter(([, c]) => c.price <= priceCap));
      }
      if (infoBySymbol.size === 0) {
        mathError = `No candidates found at or below $${priceCap!.toFixed(2)}.`;
      } else {
        math = computeMathematicalPicks(infoBySymbol);
        const mathRanked = [...infoBySymbol.values()].sort((a, b) => computeMathScore(b) - computeMathScore(a));
        const aiResult = await generateAiPicks(infoBySymbol, mathRanked);
        ai = aiResult.picks;
        aiError = aiResult.error;
        aiRawResponse = aiResult.rawResponse;
      }
    }
  } catch (e) {
    mathError = (e as Error).message;
  }

  const result: DailyPicksResult = { date, computedAt: Date.now(), maxPriceFilter: priceCap, math, mathError, ai, aiError, aiRawResponse };
  await setAppStateValue(DAILY_PICKS_KEY_PREFIX + date, JSON.stringify(result));
  return result;
}
