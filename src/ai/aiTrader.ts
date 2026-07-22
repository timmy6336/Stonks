import { fetchHistory, fetchQuote, fetchScreener, fetchTrendingSymbols } from '../api/marketData';
import { computeSignal } from '../signals/signalEngine';
import { computeTrendPrediction } from '../predictions/trendPrediction';
import { generateInsight, getActiveProviderId } from '../llm/llmClient';
import { getAiDecisionLog, getPositions, getProfileById, getWatchlist, logAiDecisionRound, recordPaperTrade } from '../db/database';
import { STOCK_CATEGORIES } from '../data/categories';
import type { AiDecisionRound, AiRiskLevel, AiTradeAction, SignalScore, TradeSide } from '../types';

// The local on-device model has a small context window, so it gets a much smaller candidate set
// than a cloud provider — otherwise the prompt alone could blow past what it can even read.
const MAX_CANDIDATES_CLOUD = 60;
const MAX_CANDIDATES_LOCAL = 15;
// Day-trader rounds run far more often (as often as every minute), so the candidate set stays
// small and focused on liquid/volatile movers rather than the full slow-moving curated universe —
// this keeps each round's network + prompt cost low enough to sustain that pace.
const MAX_CANDIDATES_DAY_TRADER_CLOUD = 25;
const MAX_CANDIDATES_DAY_TRADER_LOCAL = 10;
const FETCH_CONCURRENCY = 12;

type RiskConfig = {
  maxPositionPercent: number; // largest single BUY, as % of total portfolio value
  allowedBuySignals: SignalScore[]; // which signals a *new* buy candidate must have (holdings are always sellable)
  maxActions: number;
  description: string;
};

const RISK_CONFIG: Record<AiRiskLevel, RiskConfig> = {
  LOW: {
    maxPositionPercent: 10,
    allowedBuySignals: ['STRONG_BUY', 'BUY'],
    maxActions: 4,
    description:
      'LOW risk: preserve capital first. Only buy stocks with a BUY or STRONG_BUY signal, keep individual positions modest, and favor established, less volatile names over speculative ones. Selling to cut a clear loser or lock in a solid gain is always reasonable.',
  },
  MODERATE: {
    maxPositionPercent: 20,
    allowedBuySignals: ['STRONG_BUY', 'BUY', 'HOLD'],
    maxActions: 6,
    description:
      'MODERATE risk: balance growth and safety. You can act on BUY-or-better signals and occasionally a HOLD if the trend projection and history make a strong case, with sensible position sizes and some spread across sectors.',
  },
  HIGH: {
    maxPositionPercent: 40,
    allowedBuySignals: ['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL'],
    maxActions: 8,
    description:
      'HIGH risk: chase larger gains and accept larger swings. You may take concentrated, high-conviction positions, act on momentum or contrarian plays even against a weaker signal if the trend/history make a compelling case, and commit a larger share of cash to your best ideas.',
  },
};

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Round-robins through every source list so the combined universe stays diverse instead of one source crowding out the rest. */
function interleave(lists: string[][]): string[] {
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  const result: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (list[i]) result.push(list[i]);
    }
  }
  return result;
}

/**
 * Builds as broad a candidate universe as is practical: held positions, the watchlist, currently
 * trending symbols, today's biggest gainers/losers/most-actives, and (unless day-trading, where
 * speed and liquidity matter more than breadth) every curated category — interleaved for sector
 * diversity, then capped to whatever the active AI provider can reasonably digest in one prompt.
 */
async function buildCandidateUniverse(
  heldSymbols: string[],
  maxCandidates: number,
  includeCuratedCategories: boolean
): Promise<string[]> {
  const [watchlist, trending, gainers, losers, actives] = await Promise.all([
    getWatchlist().then((items) => items.map((w) => w.symbol)),
    fetchTrendingSymbols().catch(() => [] as string[]),
    fetchScreener('day_gainers', 15).catch(() => [] as string[]),
    fetchScreener('day_losers', 15).catch(() => [] as string[]),
    fetchScreener('most_actives', 15).catch(() => [] as string[]),
  ]);

  const sources = [heldSymbols, watchlist, trending, gainers, losers, actives];
  if (includeCuratedCategories) sources.push(...STOCK_CATEGORIES.map((c) => c.symbols));
  const interleaved = interleave(sources);
  return [...new Set(interleaved)].slice(0, maxCandidates);
}

function categoryFor(symbol: string): string {
  return STOCK_CATEGORIES.find((c) => c.symbols.includes(symbol))?.name ?? 'Other';
}

/** % change from N trading days ago to the latest close, using whatever history is available. */
function pctChangeOverTradingDays(closes: number[], daysBack: number): number | null {
  const idx = closes.length - 1 - daysBack;
  if (idx < 0) return null;
  const past = closes[idx];
  const latest = closes[closes.length - 1];
  return past !== 0 ? ((latest - past) / past) * 100 : null;
}

type CandidateInfo = {
  symbol: string;
  price: number;
  changePercent: number;
  oneMonthChangePercent: number | null;
  threeMonthChangePercent: number | null;
  signalScore: SignalScore;
  reasons: string[];
  trendDirection: 'up' | 'down' | 'flat' | null;
  trendProjectedChangePercent: number | null;
};

async function gatherCandidateInfo(symbols: string[]): Promise<Map<string, CandidateInfo>> {
  const map = new Map<string, CandidateInfo>();
  await mapWithConcurrency(symbols, FETCH_CONCURRENCY, async (symbol) => {
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
        reasons: signal.reasons.slice(0, 2), // keep the prompt compact across a large candidate set
        trendDirection: trend?.direction ?? null,
        trendProjectedChangePercent: trend?.projectedChangePercent ?? null,
      });
    } catch {
      // skip symbols we can't price right now rather than failing the whole round
    }
  });
  return map;
}

function formatCandidateLine(c: CandidateInfo): string {
  const pct = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  const trend = c.trendDirection ? `${c.trendDirection} ${pct(c.trendProjectedChangePercent)}/30d` : 'n/a';
  return `- ${c.symbol} $${c.price.toFixed(2)} (day ${pct(c.changePercent)}, 1mo ${pct(c.oneMonthChangePercent)}, 3mo ${pct(c.threeMonthChangePercent)}) sig=${c.signalScore} trend=${trend} rsn: ${c.reasons.join('; ') || 'none'}`;
}

type HoldingInfo = CandidateInfo & { quantity: number; avgCost: number; weightPercent: number };

type IntradayInfo = {
  intradayChangePercent: number | null; // change from the earliest available bar today to the latest
  lastHourChangePercent: number | null; // change over roughly the most recent hour of bars
  pctOfIntradayRange: number | null; // 0% = at today's low so far, 100% = at today's high so far
};

/**
 * Fetches short-interval intraday bars for day-trader candidates — the daily signal/trend data
 * from gatherCandidateInfo is too coarse to say anything about what a stock has done in the last
 * hour, which is what a day-trading decision actually hinges on.
 */
async function gatherIntradayInfo(symbols: string[]): Promise<Map<string, IntradayInfo>> {
  const map = new Map<string, IntradayInfo>();
  await mapWithConcurrency(symbols, FETCH_CONCURRENCY, async (symbol) => {
    try {
      const bars = await fetchHistory(symbol, '1d', '5m');
      if (bars.length < 2) return;
      const closes = bars.map((b) => b.close);
      const highs = bars.map((b) => b.high);
      const lows = bars.map((b) => b.low);
      const latest = closes[closes.length - 1];
      const first = closes[0];
      const hourBarsBack = Math.min(closes.length - 1, 12); // ~12 x 5min bars = 1 hour
      const hourAgo = closes[closes.length - 1 - hourBarsBack];
      const dayHigh = Math.max(...highs);
      const dayLow = Math.min(...lows);
      map.set(symbol, {
        intradayChangePercent: first !== 0 ? ((latest - first) / first) * 100 : null,
        lastHourChangePercent: hourAgo !== 0 ? ((latest - hourAgo) / hourAgo) * 100 : null,
        pctOfIntradayRange: dayHigh !== dayLow ? ((latest - dayLow) / (dayHigh - dayLow)) * 100 : null,
      });
    } catch {
      // no intraday bars available (e.g. market closed) — the prompt just shows "n/a" for this symbol
    }
  });
  return map;
}

const TRACK_RECORD_LOOKBACK_ROUNDS = 8;
const TRACK_RECORD_MAX_ENTRIES = 10;

/**
 * Builds a short retrospective of the day trader's own recent executed decisions — what it said
 * ("reasoning") and how the symbol has actually moved since — so each new round can see whether
 * its own recent calls are working out, not just fresh market data. This is in-context feedback
 * rather than real training (nothing here changes the model itself), but it's the practical
 * version available when the model is a hosted API or a tiny on-device one: past reasoning +
 * outcome, fed back in as part of the next prompt.
 */
async function buildRecentTrackRecord(profileId: number): Promise<string | null> {
  const recentRounds = await getAiDecisionLog(profileId, TRACK_RECORD_LOOKBACK_ROUNDS);
  const executed: { symbol: string; action: TradeSide; reasoning: string; price: number }[] = [];
  for (const round of recentRounds) {
    for (const a of round.actions) {
      if (a.executed && typeof a.price === 'number') {
        executed.push({ symbol: a.symbol, action: a.action, reasoning: a.reasoning, price: a.price });
      }
    }
  }
  if (executed.length === 0) return null;

  const recent = executed.slice(0, TRACK_RECORD_MAX_ENTRIES);
  const symbols = [...new Set(recent.map((e) => e.symbol))];
  const quotes = new Map<string, number>();
  await mapWithConcurrency(symbols, FETCH_CONCURRENCY, async (symbol) => {
    try {
      const q = await fetchQuote(symbol);
      quotes.set(symbol, q.price);
    } catch {
      // this entry just won't show an outcome below
    }
  });

  const lines: string[] = [];
  let wins = 0;
  let scored = 0;
  let sumPct = 0;
  for (const e of recent) {
    const current = quotes.get(e.symbol);
    if (current == null || e.price === 0) continue;
    const rawPct = ((current - e.price) / e.price) * 100;
    const outcomePct = e.action === 'BUY' ? rawPct : -rawPct; // a SELL "wins" if the price fell afterward
    scored++;
    sumPct += outcomePct;
    if (outcomePct > 0) wins++;
    const reasonExcerpt = e.reasoning.trim().slice(0, 60);
    lines.push(`- ${e.action} ${e.symbol} ("${reasonExcerpt}") → ${outcomePct >= 0 ? '+' : ''}${outcomePct.toFixed(1)}% since`);
  }
  if (scored === 0) return null;

  const winRate = (wins / scored) * 100;
  const avgPct = sumPct / scored;
  return `Your recent decisions and how they've gone so far — use this to notice what's working and adjust, not just repeat the same call:\n${lines.join('\n')}\nRecent record: ${winRate.toFixed(0)}% positive (${wins}/${scored}), avg ${avgPct >= 0 ? '+' : ''}${avgPct.toFixed(1)}%.`;
}

function formatDayTraderLine(c: CandidateInfo, intraday: IntradayInfo | undefined): string {
  const pct = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  const base = formatCandidateLine(c);
  if (!intraday) return `${base} | today n/a`;
  const rangePos = intraday.pctOfIntradayRange == null ? 'n/a' : `${intraday.pctOfIntradayRange.toFixed(0)}% of today's range`;
  return `${base} | today ${pct(intraday.intradayChangePercent)}, last hr ${pct(intraday.lastHourChangePercent)}, at ${rangePos}`;
}

function buildDayTraderPrompt(
  riskLevel: AiRiskLevel,
  cash: number,
  totalPortfolioValue: number,
  holdings: HoldingInfo[],
  intradayBySymbol: Map<string, IntradayInfo>,
  buyCandidates: CandidateInfo[],
  maxActions: number,
  maxPositionPercent: number,
  trackRecordText: string | null
): string {
  const holdingsText = holdings.length
    ? holdings
        .map((h) => {
          const pnlPercent = h.avgCost !== 0 ? ((h.price - h.avgCost) / h.avgCost) * 100 : 0;
          return `${formatDayTraderLine(h, intradayBySymbol.get(h.symbol))} | ${h.quantity} sh @ avg $${h.avgCost.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% unrealized), ${h.weightPercent.toFixed(0)}% of portfolio`;
        })
        .join('\n')
    : '- (no current holdings)';

  const candidatesText = buyCandidates.map((c) => formatDayTraderLine(c, intradayBySymbol.get(c.symbol))).join('\n');

  return `You are an autonomous DAY TRADER managing a simulated stock portfolio. Your goal is to make as much money as possible TODAY by actively trading — you are expected to buy and sell far more often than a long-term investor, take quick profits, cut losses fast, and re-enter a symbol again later in the day if the setup still looks good. Decide what to do RIGHT NOW using ONLY the data below; you will be asked again in just a few minutes, so it's fine to do nothing this round if nothing looks compelling.
Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{"summary": "one or two sentences on your reasoning this round", "actions": [{"action": "BUY", "symbol": "TICKER", "quantity": 1, "reasoning": "short reason"}]}
Each entry in "actions" MUST be a JSON object with those exact four fields — "action", "symbol", "quantity", "reasoning". Never put a plain string like "BUY TSLA" in the actions array; it will be rejected.
Return "actions": [] if no trade is warranted this round — that is a valid and often correct choice between rounds only minutes apart.
Note: fills are simulated with a small amount of realistic slippage, so your actual execution price may end up slightly worse than the quoted price below — this mimics real trading and is expected.

Your risk setting: ${riskLevel} — ${RISK_CONFIG[riskLevel].description}
${trackRecordText ? `\n${trackRecordText}\n` : ''}
Portfolio summary:
- Cash available now: $${cash.toFixed(2)}
- Total portfolio value: $${totalPortfolioValue.toFixed(2)}

Current holdings — the ONLY symbols you may SELL (day/1mo/3mo % change, signal, 30-day trend, today's intraday move/range, position, unrealized P&L):
${holdingsText}

Buy candidates — you do NOT own any of these yet, so they are only eligible for BUY, never SELL (day/1mo/3mo % change, signal, 30-day trend, today's intraday move/range):
${candidatesText}

Rules:
- Only use symbols from the lists above; any other symbol will be rejected.
- Only SELL a symbol that appears in "Current holdings" above with shares > 0, and never more shares than you hold there. The "Buy candidates" list is stocks you do NOT own — never propose SELL for one of those.
- No single BUY should cost more than ${maxPositionPercent}% of total portfolio value ($${((maxPositionPercent / 100) * totalPortfolioValue).toFixed(2)}).
- Keep total BUY cost across all actions within the cash available.
- quantity must be a positive whole number of shares.
- Propose at most ${maxActions} actions this round. Prefer decisive action when intraday momentum is clearly running one way; do nothing rather than force a trade when the picture is unclear.
- Keep each action's "reasoning" to one short phrase (under 12 words). You have limited output space and multiple actions to fit — a cut-off response loses ALL of your actions this round, not just the last one.`;
}

function buildPrompt(
  riskLevel: AiRiskLevel,
  startingCash: number,
  cash: number,
  totalPortfolioValue: number,
  holdings: HoldingInfo[],
  buyCandidates: CandidateInfo[],
  maxActions: number,
  maxPositionPercent: number
): string {
  const lifetimePnlPercent = startingCash !== 0 ? ((totalPortfolioValue - startingCash) / startingCash) * 100 : 0;

  const sectorTotals = new Map<string, number>();
  for (const h of holdings) {
    const cat = categoryFor(h.symbol);
    sectorTotals.set(cat, (sectorTotals.get(cat) ?? 0) + h.quantity * h.price);
  }
  const heldValue = holdings.reduce((sum, h) => sum + h.quantity * h.price, 0);
  const sectorText =
    heldValue > 0
      ? Array.from(sectorTotals.entries())
          .map(([name, value]) => `${name} ${((value / heldValue) * 100).toFixed(0)}%`)
          .join(', ')
      : 'no current exposure';

  const holdingsText = holdings.length
    ? holdings.map((h) => `${formatCandidateLine(h)} | ${h.quantity} sh @ avg $${h.avgCost.toFixed(2)}, weight ${h.weightPercent.toFixed(0)}% of portfolio`).join('\n')
    : '- (no current holdings)';

  const candidatesText = buyCandidates.map(formatCandidateLine).join('\n');

  return `You are an autonomous paper-trading agent managing a simulated stock portfolio. Decide what, if anything, to buy or sell right now using ONLY the data below. Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{"summary": "one or two sentences on your overall reasoning this round", "actions": [{"action": "BUY", "symbol": "TICKER", "quantity": 1, "reasoning": "short reason"}]}
Each entry in "actions" MUST be a JSON object with those exact four fields — "action", "symbol", "quantity", "reasoning". Never put a plain string like "BUY TSLA" in the actions array; it will be rejected.
Return "actions": [] if no trade is warranted right now — that is a valid and often correct choice. You are encouraged to propose several BUY and/or SELL actions in the same round when you have multiple good ideas, rather than limiting yourself to one.

Your risk setting: ${riskLevel} — ${RISK_CONFIG[riskLevel].description}

Portfolio summary:
- Starting cash (lifetime): $${startingCash.toFixed(2)}
- Cash available now: $${cash.toFixed(2)}
- Total portfolio value: $${totalPortfolioValue.toFixed(2)} (lifetime ${lifetimePnlPercent >= 0 ? '+' : ''}${lifetimePnlPercent.toFixed(1)}%)
- Current sector exposure: ${sectorText}

Current holdings — the ONLY symbols you may SELL (day/1mo/3mo % change, signal, 30-day trend projection, position size):
${holdingsText}

Buy candidates — you do NOT own any of these yet, so they are only eligible for BUY, never SELL (day/1mo/3mo % change, signal, 30-day trend projection):
${candidatesText}

Rules:
- Only use symbols from the lists above; any other symbol will be rejected.
- Only SELL a symbol that appears in "Current holdings" above with shares > 0, and never more shares than you hold there. The "Buy candidates" list is stocks you do NOT own — never propose SELL for one of those.
- No single BUY should cost more than ${maxPositionPercent}% of total portfolio value ($${((maxPositionPercent / 100) * totalPortfolioValue).toFixed(2)}).
- Keep total BUY cost across all actions within the cash available.
- quantity must be a positive whole number of shares.
- Propose at most ${maxActions} actions this round.
- Keep each action's "reasoning" to one short phrase (under 12 words). You have limited output space and multiple actions to fit — a cut-off response loses ALL of your actions this round, not just the last one.`;
}

/**
 * Normalizes one proposed action into a consistent shape. The AI is asked for objects, but some
 * providers (especially smaller/local models) occasionally emit plain strings like "BUY TSLA"
 * instead — rather than discarding those as "unrecognized", pull out the action/symbol/quantity
 * with a best-effort regex so a formatting slip doesn't waste the whole round.
 */
function normalizeAction(entry: unknown): { action: TradeSide | ''; symbol: string; quantity: number; reasoning: string } {
  if (entry && typeof entry === 'object') {
    const e = entry as Record<string, unknown>;
    return {
      action: e.action === 'SELL' ? 'SELL' : e.action === 'BUY' ? 'BUY' : '',
      symbol: typeof e.symbol === 'string' ? e.symbol.toUpperCase() : '',
      quantity: Math.floor(Number(e.quantity)),
      reasoning: typeof e.reasoning === 'string' ? e.reasoning.slice(0, 300) : '',
    };
  }
  if (typeof entry === 'string') {
    const actionMatch = entry.match(/\b(BUY|SELL)\b/i);
    const action: TradeSide | '' = actionMatch ? (actionMatch[1].toUpperCase() as TradeSide) : '';
    const withoutAction = entry.toUpperCase().replace(/\b(BUY|SELL)\b/, '');
    const symbolMatch = withoutAction.match(/[A-Z]{1,6}(?:\.[A-Z]{1,3})?/);
    const qtyMatch = entry.match(/\d+/);
    return {
      action,
      symbol: symbolMatch ? symbolMatch[0] : '',
      quantity: qtyMatch ? parseInt(qtyMatch[0], 10) : 1,
      reasoning: '(the AI sent a plain-text action instead of the requested JSON object; quantity was inferred and defaults to 1 if unspecified)',
    };
  }
  return { action: '', symbol: '', quantity: 0, reasoning: '' };
}

/**
 * Simulates a non-instantaneous, imperfect fill instead of executing at the exact last-quoted
 * price. Real orders cross a bid-ask spread and take a moment to route/fill, during which the
 * price can drift — modeled here as a small random slippage that always nudges the fill slightly
 * against the trader (buys fill a bit higher, sells a bit lower).
 */
function simulateFill(quotePrice: number, side: TradeSide): number {
  const slippageBps = 2 + Math.random() * 8; // ~0.02%-0.10%, in line with a liquid large-cap's typical spread
  const factor = side === 'BUY' ? 1 + slippageBps / 10000 : 1 - slippageBps / 10000;
  return Math.round(quotePrice * factor * 100) / 100;
}

/**
 * Salvages whatever it can from a response whose overall JSON structure doesn't parse — either
 * because it got cut off mid-object (the provider hit its output token limit, often mid-way
 * through an action's "reasoning" string) or because of a structural slip like wrapping each
 * action in its own stray array instead of one flat "actions" array. Either way, pull out the
 * summary text and every *complete* action object via regex; an action object is flat (no nested
 * braces), so a balanced `{...}` match reliably captures only whole ones regardless of whatever
 * invalid punctuation surrounds them, and naturally skips a trailing partial one.
 */
function recoverMalformedResponse(text: string): { summary?: string; actions?: unknown[] } {
  const summaryMatch = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const actionMatches = text.match(/\{[^{}]*\}/g) ?? [];
  const actions: unknown[] = [];
  for (const m of actionMatches) {
    try {
      const obj = JSON.parse(m);
      if (obj && typeof obj === 'object' && 'action' in obj) actions.push(obj);
    } catch {
      // this object itself didn't parse either — skip it, not worth guessing at
    }
  }
  if (!summaryMatch && actions.length === 0) {
    throw new Error('Response did not contain a usable JSON object.');
  }
  const recoveryNote = ' [recovered from a malformed response — some actions may be missing]';
  return {
    summary: (summaryMatch ? summaryMatch[1] : 'No summary provided.') + recoveryNote,
    actions,
  };
}

function extractJson(raw: string): { summary?: string; actions?: unknown[] } {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced ? fenced[1] : raw;
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('Response did not contain a JSON object.');
  }

  const end = text.lastIndexOf('}');
  if (end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // fall through — the slice from first '{' to last '}' wasn't valid JSON (truncated, or malformed)
    }
  }

  return recoverMalformedResponse(text.slice(start));
}

/**
 * Runs one autonomous trading round for an AI-managed save: gathers price, recent-history %
 * change, trend projection, and signal data for the save's current holdings plus a broad
 * candidate universe (buy candidates are pre-filtered by the save's risk setting), asks the
 * active AI provider for buy/sell decisions, validates each one against real cash/holdings/
 * position-size constraints, and executes whatever passes through the same paper-trading engine
 * manual trades use. Every round is logged in full for transparency.
 */
export async function runAiTradingRound(profileId: number): Promise<AiDecisionRound> {
  const [profile, positions, activeProviderId] = await Promise.all([
    getProfileById(profileId),
    getPositions(profileId),
    getActiveProviderId(),
  ]);
  if (!profile) {
    return logAiDecisionRound(profileId, 'Save no longer exists — skipped.', null, []);
  }

  const cash = profile.cashBalance;
  const riskConfig = RISK_CONFIG[profile.riskLevel];
  const isDayTrader = profile.tradingStyle === 'DAY_TRADER';
  const heldSymbols = positions.map((p) => p.symbol);
  const maxCandidates = isDayTrader
    ? activeProviderId === 'local'
      ? MAX_CANDIDATES_DAY_TRADER_LOCAL
      : MAX_CANDIDATES_DAY_TRADER_CLOUD
    : activeProviderId === 'local'
      ? MAX_CANDIDATES_LOCAL
      : MAX_CANDIDATES_CLOUD;
  const candidateSymbols = await buildCandidateUniverse(heldSymbols, maxCandidates, !isDayTrader);
  const [infoBySymbol, intradayBySymbol, trackRecordText] = await Promise.all([
    gatherCandidateInfo(candidateSymbols),
    isDayTrader ? gatherIntradayInfo(candidateSymbols) : Promise.resolve(new Map<string, IntradayInfo>()),
    isDayTrader ? buildRecentTrackRecord(profileId) : Promise.resolve(null),
  ]);

  const heldValue = positions.reduce((sum, p) => sum + p.quantity * (infoBySymbol.get(p.symbol)?.price ?? p.avgCost), 0);
  const totalPortfolioValue = cash + heldValue;

  const holdingsForPrompt: HoldingInfo[] = positions
    .map((p) => {
      const info = infoBySymbol.get(p.symbol);
      if (!info) return null;
      const weightPercent = totalPortfolioValue > 0 ? ((p.quantity * info.price) / totalPortfolioValue) * 100 : 0;
      return { ...info, quantity: p.quantity, avgCost: p.avgCost, weightPercent };
    })
    .filter((h): h is HoldingInfo => h !== null);

  const buyCandidates = Array.from(infoBySymbol.values()).filter(
    (c) => !heldSymbols.includes(c.symbol) && riskConfig.allowedBuySignals.includes(c.signalScore)
  );

  if (holdingsForPrompt.length === 0 && buyCandidates.length === 0) {
    return logAiDecisionRound(profileId, 'No market data available this round — skipped.', null, []);
  }

  const prompt = isDayTrader
    ? buildDayTraderPrompt(
        profile.riskLevel,
        cash,
        totalPortfolioValue,
        holdingsForPrompt,
        intradayBySymbol,
        buyCandidates,
        riskConfig.maxActions,
        riskConfig.maxPositionPercent,
        trackRecordText
      )
    : buildPrompt(
        profile.riskLevel,
        profile.startingCash,
        cash,
        totalPortfolioValue,
        holdingsForPrompt,
        buyCandidates,
        riskConfig.maxActions,
        riskConfig.maxPositionPercent
      );

  let rawResponse: string;
  try {
    rawResponse = await generateInsight(prompt);
  } catch (e) {
    return logAiDecisionRound(profileId, `Could not reach the AI provider: ${(e as Error).message}`, null, []);
  }

  let parsed: { summary?: string; actions?: unknown[] };
  try {
    parsed = extractJson(rawResponse);
  } catch (e) {
    return logAiDecisionRound(profileId, `AI response could not be parsed: ${(e as Error).message}`, rawResponse, []);
  }

  const proposedActions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, riskConfig.maxActions) : [];
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : 'No summary provided.';

  // Validate + execute sequentially against a running simulated ledger so a multi-action round can't overspend.
  let runningCash = cash;
  const runningHoldings = new Map(positions.map((p) => [p.symbol, p.quantity]));
  const positionCap = (riskConfig.maxPositionPercent / 100) * totalPortfolioValue;
  const results: AiTradeAction[] = [];

  for (const entry of proposedActions) {
    const { action, symbol, quantity, reasoning } = normalizeAction(entry);
    const info = infoBySymbol.get(symbol);

    const fail = (error: string) => {
      results.push({ action: action || 'BUY', symbol: symbol || '?', quantity: quantity || 0, reasoning, executed: false, error, price: info?.price });
    };

    if (!action) {
      fail('Unrecognized action type.');
      continue;
    }
    if (!symbol || !info) {
      fail(`"${symbol || '(missing)'}" is not in the allowed symbol list.`);
      continue;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      fail('Quantity must be a positive whole number.');
      continue;
    }
    if (action === 'BUY' && !heldSymbols.includes(symbol) && !riskConfig.allowedBuySignals.includes(info.signalScore)) {
      fail(`${symbol}'s ${info.signalScore} signal isn't allowed for new buys at ${profile.riskLevel} risk.`);
      continue;
    }

    if (action === 'BUY') {
      const fillPrice = simulateFill(info.price, 'BUY');
      const cost = quantity * fillPrice;
      if (cost > positionCap) {
        fail(`Cost $${cost.toFixed(2)} exceeds the ${riskConfig.maxPositionPercent}% position-size cap ($${positionCap.toFixed(2)}) for ${profile.riskLevel} risk.`);
        continue;
      }
      if (cost > runningCash) {
        fail(`Cost $${cost.toFixed(2)} exceeds remaining cash $${runningCash.toFixed(2)}.`);
        continue;
      }
      try {
        await recordPaperTrade(symbol, 'BUY', quantity, fillPrice, profileId);
        runningCash -= cost;
        runningHoldings.set(symbol, (runningHoldings.get(symbol) ?? 0) + quantity);
        results.push({ action, symbol, quantity, reasoning, executed: true, price: fillPrice });
      } catch (e) {
        fail((e as Error).message);
      }
    } else {
      const held = runningHoldings.get(symbol) ?? 0;
      if (quantity > held) {
        fail(`Cannot sell ${quantity} shares — only ${held} held.`);
        continue;
      }
      try {
        const fillPrice = simulateFill(info.price, 'SELL');
        await recordPaperTrade(symbol, 'SELL', quantity, fillPrice, profileId);
        runningCash += quantity * fillPrice;
        runningHoldings.set(symbol, held - quantity);
        results.push({ action, symbol, quantity, reasoning, executed: true, price: fillPrice });
      } catch (e) {
        fail((e as Error).message);
      }
    }
  }

  return logAiDecisionRound(profileId, summary, rawResponse, results);
}
