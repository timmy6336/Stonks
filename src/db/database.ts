import * as SQLite from 'expo-sqlite';
import type { Position, Trade, TradeMode, TradeSide, WatchlistItem } from '../types';

const STARTING_PAPER_CASH = 100_000;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('stonks.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS watchlist (
          symbol TEXT PRIMARY KEY NOT NULL,
          added_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS positions (
          symbol TEXT PRIMARY KEY NOT NULL,
          quantity REAL NOT NULL,
          avg_cost REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          quantity REAL NOT NULL,
          price REAL NOT NULL,
          timestamp INTEGER NOT NULL,
          mode TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cash (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          balance REAL NOT NULL
        );
      `);
      const row = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM cash WHERE id = 1');
      if (!row) {
        await db.runAsync('INSERT INTO cash (id, balance) VALUES (1, ?)', STARTING_PAPER_CASH);
      }
      return db;
    });
  }
  return dbPromise;
}

// --- Watchlist ---

export async function getWatchlist(): Promise<WatchlistItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ symbol: string; added_at: number }>(
    'SELECT symbol, added_at FROM watchlist ORDER BY added_at ASC'
  );
  return rows.map((r) => ({ symbol: r.symbol, addedAt: r.added_at }));
}

export async function addToWatchlist(symbol: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR IGNORE INTO watchlist (symbol, added_at) VALUES (?, ?)',
    symbol.toUpperCase(),
    Date.now()
  );
}

export async function removeFromWatchlist(symbol: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM watchlist WHERE symbol = ?', symbol.toUpperCase());
}

// --- Paper trading: cash, positions, trades ---

export async function getCashBalance(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM cash WHERE id = 1');
  return row?.balance ?? STARTING_PAPER_CASH;
}

export async function getPositions(): Promise<Position[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ symbol: string; quantity: number; avg_cost: number }>(
    'SELECT symbol, quantity, avg_cost FROM positions ORDER BY symbol ASC'
  );
  return rows.map((r) => ({ symbol: r.symbol, quantity: r.quantity, avgCost: r.avg_cost }));
}

export async function getPosition(symbol: string): Promise<Position | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ symbol: string; quantity: number; avg_cost: number }>(
    'SELECT symbol, quantity, avg_cost FROM positions WHERE symbol = ?',
    symbol.toUpperCase()
  );
  return row ? { symbol: row.symbol, quantity: row.quantity, avgCost: row.avg_cost } : null;
}

export async function getTrades(mode?: TradeMode): Promise<Trade[]> {
  const db = await getDb();
  const rows = mode
    ? await db.getAllAsync<any>('SELECT * FROM trades WHERE mode = ? ORDER BY timestamp DESC', mode)
    : await db.getAllAsync<any>('SELECT * FROM trades ORDER BY timestamp DESC');
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    side: r.side,
    quantity: r.quantity,
    price: r.price,
    timestamp: r.timestamp,
    mode: r.mode,
  }));
}

/** Records a filled paper trade: adjusts cash and the position's weighted-average cost. */
export async function recordPaperTrade(symbol: string, side: TradeSide, quantity: number, price: number): Promise<void> {
  const db = await getDb();
  const upperSymbol = symbol.toUpperCase();
  const cost = quantity * price;

  await db.withTransactionAsync(async () => {
    const cashRow = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM cash WHERE id = 1');
    const cash = cashRow?.balance ?? STARTING_PAPER_CASH;
    const existing = await db.getFirstAsync<{ quantity: number; avg_cost: number }>(
      'SELECT quantity, avg_cost FROM positions WHERE symbol = ?',
      upperSymbol
    );

    if (side === 'BUY') {
      if (cost > cash) throw new Error('Insufficient paper cash balance for this purchase.');
      const newQuantity = (existing?.quantity ?? 0) + quantity;
      const newAvgCost = existing
        ? (existing.avg_cost * existing.quantity + cost) / newQuantity
        : price;
      await db.runAsync(
        'INSERT INTO positions (symbol, quantity, avg_cost) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET quantity = ?, avg_cost = ?',
        upperSymbol, newQuantity, newAvgCost, newQuantity, newAvgCost
      );
      await db.runAsync('UPDATE cash SET balance = ? WHERE id = 1', cash - cost);
    } else {
      const held = existing?.quantity ?? 0;
      if (quantity > held) throw new Error('Cannot sell more shares than you hold in paper trading.');
      const remaining = held - quantity;
      if (remaining <= 0) {
        await db.runAsync('DELETE FROM positions WHERE symbol = ?', upperSymbol);
      } else {
        await db.runAsync('UPDATE positions SET quantity = ? WHERE symbol = ?', remaining, upperSymbol);
      }
      await db.runAsync('UPDATE cash SET balance = ? WHERE id = 1', cash + cost);
    }

    await db.runAsync(
      'INSERT INTO trades (symbol, side, quantity, price, timestamp, mode) VALUES (?, ?, ?, ?, ?, ?)',
      upperSymbol, side, quantity, price, Date.now(), 'PAPER'
    );
  });
}

/** Records a live trade fill for history purposes only (Alpaca is the source of truth for real positions/cash). */
export async function recordLiveTrade(symbol: string, side: TradeSide, quantity: number, price: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO trades (symbol, side, quantity, price, timestamp, mode) VALUES (?, ?, ?, ?, ?, ?)',
    symbol.toUpperCase(), side, quantity, price, Date.now(), 'LIVE'
  );
}

export async function resetPaperAccount(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM positions');
    await db.runAsync("DELETE FROM trades WHERE mode = 'PAPER'");
    await db.runAsync('UPDATE cash SET balance = ? WHERE id = 1', STARTING_PAPER_CASH);
  });
}
