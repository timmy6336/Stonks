import * as SecureStore from 'expo-secure-store';
import type { TradeSide } from '../types';

const KEY_ID_STORE_KEY = 'alpaca_key_id';
const SECRET_STORE_KEY = 'alpaca_secret_key';
const LIVE_ENABLED_STORE_KEY = 'alpaca_live_enabled';

const PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
const LIVE_BASE_URL = 'https://api.alpaca.markets';

export type AlpacaCredentials = {
  keyId: string;
  secretKey: string;
};

export async function saveAlpacaCredentials(creds: AlpacaCredentials): Promise<void> {
  await SecureStore.setItemAsync(KEY_ID_STORE_KEY, creds.keyId);
  await SecureStore.setItemAsync(SECRET_STORE_KEY, creds.secretKey);
}

export async function getAlpacaCredentials(): Promise<AlpacaCredentials | null> {
  const keyId = await SecureStore.getItemAsync(KEY_ID_STORE_KEY);
  const secretKey = await SecureStore.getItemAsync(SECRET_STORE_KEY);
  if (!keyId || !secretKey) return null;
  return { keyId, secretKey };
}

export async function clearAlpacaCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_ID_STORE_KEY);
  await SecureStore.deleteItemAsync(SECRET_STORE_KEY);
  await SecureStore.deleteItemAsync(LIVE_ENABLED_STORE_KEY);
}

/** Live trading is opt-in and stored separately so it can never default to "on". */
export async function isLiveTradingEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(LIVE_ENABLED_STORE_KEY)) === 'true';
}

export async function setLiveTradingEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(LIVE_ENABLED_STORE_KEY, enabled ? 'true' : 'false');
}

async function alpacaRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const creds = await getAlpacaCredentials();
  if (!creds) {
    throw new Error('No Alpaca API credentials saved. Add them in Settings first.');
  }
  const live = await isLiveTradingEnabled();
  const baseUrl = live ? LIVE_BASE_URL : PAPER_BASE_URL;

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'APCA-API-KEY-ID': creds.keyId,
      'APCA-API-SECRET-KEY': creds.secretKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Alpaca API error (${res.status}): ${body || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type AlpacaAccount = {
  id: string;
  cash: string;
  portfolio_value: string;
  buying_power: string;
  status: string;
};

export function getAlpacaAccount(): Promise<AlpacaAccount> {
  return alpacaRequest<AlpacaAccount>('/v2/account');
}

export type AlpacaOrder = {
  id: string;
  symbol: string;
  qty: string;
  side: TradeSide;
  status: string;
  filled_avg_price: string | null;
};

/** Places a market order. In paper mode this fills against Alpaca's simulated paper account; in live mode it is a real order. */
export function placeAlpacaOrder(symbol: string, side: TradeSide, quantity: number): Promise<AlpacaOrder> {
  return alpacaRequest<AlpacaOrder>('/v2/orders', {
    method: 'POST',
    body: JSON.stringify({
      symbol: symbol.toUpperCase(),
      qty: quantity,
      side: side.toLowerCase(),
      type: 'market',
      time_in_force: 'day',
    }),
  });
}

export function getAlpacaPositions(): Promise<Array<{ symbol: string; qty: string; avg_entry_price: string }>> {
  return alpacaRequest('/v2/positions');
}
