import { fetchHistory, fetchQuote, fetchScreener, fetchTrendingSymbols } from '../api/marketData';
import { computeSignal } from '../signals/signalEngine';
import { computeTrendPrediction } from '../predictions/trendPrediction';
import { generateInsight, getActiveProviderId } from '../llm/llmClient';
import { getPositions, getProfileById, getWatchlist, logAiDecisionRound, recordPaperTrade } from '../db/database';
import { STOCK_CATEGORIES } from '../data/categories';
import type { AiDecisionRound, AiRiskLevel, AiTradeAction, SignalScore, TradeSide } from '../types';

// The local on-device model has a small context window, so it gets a much smaller candidate set
// than a cloud provider — otherwise the prompt alone could blow past what it can even read.
const MAX_CANDIDATES_CLOUD = 60;
const MAX_CANDIDATES_LOCAL = 15;
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
 * trending symbols, today's biggest gainers/losers/most-actives, and every curated category —
 * interleaved for sector diversity, then capped to whatever the active AI provider can reasonably
 * digest in one prompt.
 */
async function buildCandidateUniverse(heldSymbols: string[], maxCandidates: number): Promise<string[]> {
  const [watchlist, trending, gainers, losers, actives] = await Promise.all([
    getWatchlist().then((items) => items.map((w) => w.symbol)),
    fetchTrendingSymbols().catch(() => [] as string[]),
    fetchScreener('day_gainers', 15).catch(() => [] as string[]),
    fetchScreener('day_losers', 15).catch(() => [] as string[]),
    fetchScreener('most_actives', 15).catch(() => [] as string[]),
  ]);

  const sources = [heldSymbols, watchlist, trending, gainers, losers, actives, ...STOCK_CATEGORIES.map((c) => c.symbols)];
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
Return "actions": [] if no trade is warranted right now — that is a valid and often correct choice. You are encouraged to propose several BUY and/or SELL actions in the same round when you have multiple good ideas, rather than limiting yourself to one.

Your risk setting: ${riskLevel} — ${RISK_CONFIG[riskLevel].description}

Portfolio summary:
- Starting cash (lifetime): $${startingCash.toFixed(2)}
- Cash available now: $${cash.toFixed(2)}
- Total portfolio value: $${totalPortfolioValue.toFixed(2)} (lifetime ${lifetimePnlPercent >= 0 ? '+' : ''}${lifetimePnlPercent.toFixed(1)}%)
- Current sector exposure: ${sectorText}

Current holdings (day/1mo/3mo % change, signal, 30-day trend projection, position size):
${holdingsText}

Buy candidates — signal-filtered for your ${riskLevel} risk setting (day/1mo/3mo % change, signal, 30-day trend projection):
${candidatesText}

Rules:
- Only use symbols from the lists above; any other symbol will be rejected.
- Only SELL symbols you currently hold, and never more shares than you hold.
- No single BUY should cost more than ${maxPositionPercent}% of total portfolio value ($${((maxPositionPercent / 100) * totalPortfolioValue).toFixed(2)}).
- Keep total BUY cost across all actions within the cash available.
- quantity must be a positive whole number of shares.
- Propose at most ${maxActions} actions this round.`;
}

function extractJson(raw: string): { summary?: string; actions?: unknown[] } {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced ? fenced[1] : raw;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Response did not contain a JSON object.');
  }
  return JSON.parse(text.slice(start, end + 1));
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
  const heldSymbols = positions.map((p) => p.symbol);
  const maxCandidates = activeProviderId === 'local' ? MAX_CANDIDATES_LOCAL : MAX_CANDIDATES_CLOUD;
  const candidateSymbols = await buildCandidateUniverse(heldSymbols, maxCandidates);
  const infoBySymbol = await gatherCandidateInfo(candidateSymbols);

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

  const prompt = buildPrompt(
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

  for (const entry of proposedActions as Record<string, unknown>[]) {
    const symbol = typeof entry?.symbol === 'string' ? entry.symbol.toUpperCase() : '';
    const action: TradeSide | '' = entry?.action === 'SELL' ? 'SELL' : entry?.action === 'BUY' ? 'BUY' : '';
    const quantity = Math.floor(Number(entry?.quantity));
    const reasoning = typeof entry?.reasoning === 'string' ? entry.reasoning.slice(0, 300) : '';
    const info = infoBySymbol.get(symbol);

    const fail = (error: string) => {
      results.push({ action: action || 'BUY', symbol: symbol || '?', quantity: quantity || 0, reasoning, executed: false, error });
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
      const cost = quantity * info.price;
      if (cost > positionCap) {
        fail(`Cost $${cost.toFixed(2)} exceeds the ${riskConfig.maxPositionPercent}% position-size cap ($${positionCap.toFixed(2)}) for ${profile.riskLevel} risk.`);
        continue;
      }
      if (cost > runningCash) {
        fail(`Cost $${cost.toFixed(2)} exceeds remaining cash $${runningCash.toFixed(2)}.`);
        continue;
      }
      try {
        await recordPaperTrade(symbol, 'BUY', quantity, info.price, profileId);
        runningCash -= cost;
        runningHoldings.set(symbol, (runningHoldings.get(symbol) ?? 0) + quantity);
        results.push({ action, symbol, quantity, reasoning, executed: true });
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
        await recordPaperTrade(symbol, 'SELL', quantity, info.price, profileId);
        runningCash += quantity * info.price;
        runningHoldings.set(symbol, held - quantity);
        results.push({ action, symbol, quantity, reasoning, executed: true });
      } catch (e) {
        fail((e as Error).message);
      }
    }
  }

  return logAiDecisionRound(profileId, summary, rawResponse, results);
}
