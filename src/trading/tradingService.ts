import type { TradeSide, TradingMode } from '../types';
import { recordLiveTrade, recordPaperTrade } from '../db/database';
import { isLiveTradingEnabled, placeAlpacaOrder } from '../alpaca/alpacaClient';

export async function getActiveTradingMode(): Promise<TradingMode> {
  return (await isLiveTradingEnabled()) ? 'LIVE' : 'PAPER';
}

/**
 * Executes a trade in whichever mode is currently active.
 * PAPER: fully local simulation, no external account needed.
 * LIVE: places a real market order through the user's own Alpaca account.
 * `quotePrice` is used to update the local paper ledger, and as the recorded
 * price for live fills (Alpaca confirms the actual fill asynchronously).
 */
export async function executeTrade(symbol: string, side: TradeSide, quantity: number, quotePrice: number): Promise<void> {
  const mode = await getActiveTradingMode();
  if (mode === 'LIVE') {
    await placeAlpacaOrder(symbol, side, quantity);
    await recordLiveTrade(symbol, side, quantity, quotePrice);
  } else {
    await recordPaperTrade(symbol, side, quantity, quotePrice);
  }
}
