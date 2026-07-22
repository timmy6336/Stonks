import { fetchHistory, fetchQuote, fetchScreener, fetchTrendingSymbols } from '../api/marketData';
import { computeSignal } from '../signals/signalEngine';
import { generateInsight, getActiveProviderId } from '../llm/llmClient';
import { getCashBalance, getPositions, getWatchlist, logAiDecisionRound, recordPaperTrade } from '../db/database';
import { STOCK_CATEGORIES } from '../data/categories';
import type { AiDecisionRound, AiTradeAction, TradeSide } from '../types';

// The local on-device model has a small context window, so it gets a much smaller candidate set
// than a cloud provider — otherwise the prompt alone could blow past what it can even read.
const MAX_CANDIDATES_CLOUD = 60;
const MAX_CANDIDATES_LOCAL = 15;
const MAX_ACTIONS_PER_ROUND = 5;
const FETCH_CONCURRENCY = 12;

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

type CandidateInfo = {
  symbol: string;
  price: number;
  changePercent: number;
  signalScore: string;
  reasons: string[];
};

async function gatherCandidateInfo(symbols: string[]): Promise<Map<string, CandidateInfo>> {
  const map = new Map<string, CandidateInfo>();
  await mapWithConcurrency(symbols, FETCH_CONCURRENCY, async (symbol) => {
    try {
      const [quote, history] = await Promise.all([fetchQuote(symbol), fetchHistory(symbol, '6mo', '1d')]);
      const signal = computeSignal(symbol, history);
      map.set(symbol, {
        symbol,
        price: quote.price,
        changePercent: quote.changePercent,
        signalScore: signal.score,
        reasons: signal.reasons.slice(0, 2), // keep the prompt compact across a large candidate set
      });
    } catch {
      // skip symbols we can't price right now rather than failing the whole round
    }
  });
  return map;
}

function buildPrompt(
  cash: number,
  holdings: { symbol: string; quantity: number; avgCost: number; currentPrice: number }[],
  candidates: CandidateInfo[]
): string {
  const holdingsText = holdings.length
    ? holdings
        .map((h) => {
          const pnlPercent = h.avgCost !== 0 ? ((h.currentPrice - h.avgCost) / h.avgCost) * 100 : 0;
          return `- ${h.symbol}: ${h.quantity} shares @ avg $${h.avgCost.toFixed(2)}, now $${h.currentPrice.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)`;
        })
        .join('\n')
    : '- (no current holdings)';

  const candidatesText = candidates
    .map(
      (c) =>
        `- ${c.symbol}: $${c.price.toFixed(2)} (${c.changePercent >= 0 ? '+' : ''}${c.changePercent.toFixed(1)}% today), signal ${c.signalScore}, reasons: ${c.reasons.join('; ')}`
    )
    .join('\n');

  return `You are an autonomous paper-trading agent managing a simulated stock portfolio. Decide what, if anything, to buy or sell right now using ONLY the data below. Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{"summary": "one sentence on your overall reasoning this round", "actions": [{"action": "BUY", "symbol": "TICKER", "quantity": 1, "reasoning": "short reason"}]}
Return "actions": [] if no trade is warranted right now — that is a valid and often correct choice.

Account:
- Cash available: $${cash.toFixed(2)}
- Current holdings:
${holdingsText}

Symbols you may act on (buy candidates and/or current holdings):
${candidatesText}

Rules:
- Only use symbols from the list above; any other symbol will be rejected.
- Only SELL symbols you currently hold, and never more shares than you hold.
- Keep total BUY cost within the cash available.
- quantity must be a positive whole number of shares.`;
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
 * Runs one autonomous trading round for an AI-managed save: gathers price/signal data for the
 * save's watchlist plus a curated candidate set, asks the active AI provider for buy/sell
 * decisions, validates them against real cash/holdings constraints, and executes whatever passes
 * through the same paper-trading engine manual trades use. Every round is logged in full (prompt
 * inputs aside, but the raw response and every action's outcome) for transparency.
 */
export async function runAiTradingRound(profileId: number): Promise<AiDecisionRound> {
  const [cash, positions, activeProviderId] = await Promise.all([
    getCashBalance(profileId),
    getPositions(profileId),
    getActiveProviderId(),
  ]);
  const heldSymbols = positions.map((p) => p.symbol);
  const maxCandidates = activeProviderId === 'local' ? MAX_CANDIDATES_LOCAL : MAX_CANDIDATES_CLOUD;
  const candidateSymbols = await buildCandidateUniverse(heldSymbols, maxCandidates);
  const infoBySymbol = await gatherCandidateInfo(candidateSymbols);

  const holdingsForPrompt = positions
    .map((p) => {
      const info = infoBySymbol.get(p.symbol);
      return info ? { symbol: p.symbol, quantity: p.quantity, avgCost: p.avgCost, currentPrice: info.price } : null;
    })
    .filter((h): h is NonNullable<typeof h> => h !== null);

  const candidateList = Array.from(infoBySymbol.values());
  if (candidateList.length === 0) {
    return logAiDecisionRound(profileId, 'No market data available this round — skipped.', null, []);
  }

  const prompt = buildPrompt(cash, holdingsForPrompt, candidateList);

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

  const proposedActions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, MAX_ACTIONS_PER_ROUND) : [];
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : 'No summary provided.';

  // Validate + execute sequentially against a running simulated ledger so a multi-action round can't overspend.
  let runningCash = cash;
  const runningHoldings = new Map(positions.map((p) => [p.symbol, p.quantity]));
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

    if (action === 'BUY') {
      const cost = quantity * info.price;
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
