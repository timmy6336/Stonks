import * as SQLite from 'expo-sqlite';
import type { AiDecisionRound, AiRiskLevel, AiTradeAction, AiTradingStyle, Alert, AlertType, Position, Profile, SignalScore, Trade, TradeMode, TradeSide, WatchlistItem } from '../types';

export const DEFAULT_STARTING_CASH = 100_000;
const ACTIVE_PROFILE_KEY = 'active_profile_id';

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
        CREATE TABLE IF NOT EXISTS profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          starting_cash REAL NOT NULL,
          cash_balance REAL NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS positions (
          profile_id INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          quantity REAL NOT NULL,
          avg_cost REAL NOT NULL,
          PRIMARY KEY (profile_id, symbol)
        );
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          quantity REAL NOT NULL,
          price REAL NOT NULL,
          timestamp INTEGER NOT NULL,
          mode TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          type TEXT NOT NULL,
          threshold REAL,
          created_at INTEGER NOT NULL,
          triggered_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS signal_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          score TEXT NOT NULL,
          points INTEGER NOT NULL,
          price REAL NOT NULL,
          logged_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL,
          timestamp INTEGER NOT NULL,
          summary TEXT NOT NULL,
          raw_response TEXT,
          actions_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS listed_symbols (
          symbol TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          exchange TEXT NOT NULL
        );
      `);

      await migrateFromLegacySingleProfileSchema(db);
      await migrateAddAiManagedColumn(db);
      await migrateAddRiskLevelColumn(db);
      await migrateAddTradingStyleColumn(db);

      const { count } = (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM profiles')) ?? { count: 0 };
      if (count === 0) {
        const id = await insertProfile(db, 'Default', DEFAULT_STARTING_CASH);
        await setActiveProfileIdOnDb(db, id);
      }

      return db;
    });
  }
  return dbPromise;
}

/** Upgrades installs from before multi-profile support: old single `cash` row + flat positions/trades. */
async function migrateFromLegacySingleProfileSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  const legacyCashTable = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cash'"
  );
  if (!legacyCashTable) return;

  const positionsColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(positions)');
  const alreadyMigrated = positionsColumns.some((c) => c.name === 'profile_id');
  if (alreadyMigrated) {
    await db.execAsync('DROP TABLE IF EXISTS cash');
    return;
  }

  await db.withTransactionAsync(async () => {
    await db.execAsync('ALTER TABLE positions RENAME TO positions_legacy');
    await db.execAsync('ALTER TABLE trades RENAME TO trades_legacy');
    await db.execAsync(`
      CREATE TABLE positions (
        profile_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        quantity REAL NOT NULL,
        avg_cost REAL NOT NULL,
        PRIMARY KEY (profile_id, symbol)
      );
      CREATE TABLE trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        mode TEXT NOT NULL
      );
    `);

    const cashRow = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM cash WHERE id = 1');
    const cashBalance = cashRow?.balance ?? DEFAULT_STARTING_CASH;
    const defaultProfileId = await insertProfile(db, 'Default', DEFAULT_STARTING_CASH, cashBalance);

    await db.runAsync(
      'INSERT INTO positions (profile_id, symbol, quantity, avg_cost) SELECT ?, symbol, quantity, avg_cost FROM positions_legacy',
      defaultProfileId
    );
    await db.runAsync(
      `INSERT INTO trades (profile_id, symbol, side, quantity, price, timestamp, mode)
       SELECT CASE WHEN mode = 'PAPER' THEN ? ELSE NULL END, symbol, side, quantity, price, timestamp, mode
       FROM trades_legacy`,
      defaultProfileId
    );

    await db.execAsync('DROP TABLE positions_legacy');
    await db.execAsync('DROP TABLE trades_legacy');
    await db.execAsync('DROP TABLE cash');

    await setActiveProfileIdOnDb(db, defaultProfileId);
  });
}

/** Upgrades installs from before AI-managed saves existed, which had no is_ai_managed column. */
async function migrateAddAiManagedColumn(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(profiles)');
  if (!columns.some((c) => c.name === 'is_ai_managed')) {
    await db.execAsync('ALTER TABLE profiles ADD COLUMN is_ai_managed INTEGER NOT NULL DEFAULT 0');
  }
}

/** Upgrades installs from before the AI Trader's risk setting existed. */
async function migrateAddRiskLevelColumn(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(profiles)');
  if (!columns.some((c) => c.name === 'risk_level')) {
    await db.execAsync("ALTER TABLE profiles ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'MODERATE'");
  }
}

/** Upgrades installs from before day-trader mode existed. */
async function migrateAddTradingStyleColumn(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(profiles)');
  if (!columns.some((c) => c.name === 'trading_style')) {
    await db.execAsync("ALTER TABLE profiles ADD COLUMN trading_style TEXT NOT NULL DEFAULT 'STANDARD'");
  }
}

async function insertProfile(
  db: SQLite.SQLiteDatabase,
  name: string,
  startingCash: number,
  cashBalance = startingCash,
  isAiManaged = false,
  riskLevel: AiRiskLevel = 'MODERATE',
  tradingStyle: AiTradingStyle = 'STANDARD'
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO profiles (name, starting_cash, cash_balance, created_at, is_ai_managed, risk_level, trading_style) VALUES (?, ?, ?, ?, ?, ?, ?)',
    name, startingCash, cashBalance, Date.now(), isAiManaged ? 1 : 0, riskLevel, tradingStyle
  );
  return result.lastInsertRowId;
}

async function setActiveProfileIdOnDb(db: SQLite.SQLiteDatabase, profileId: number): Promise<void> {
  await db.runAsync(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ACTIVE_PROFILE_KEY, String(profileId)
  );
}

// --- Profiles (paper trading "saves") ---

type ProfileRow = {
  id: number;
  name: string;
  starting_cash: number;
  cash_balance: number;
  created_at: number;
  is_ai_managed: number;
  risk_level: AiRiskLevel;
  trading_style: AiTradingStyle;
};

function mapProfileRow(r: ProfileRow): Profile {
  return {
    id: r.id,
    name: r.name,
    startingCash: r.starting_cash,
    cashBalance: r.cash_balance,
    createdAt: r.created_at,
    isAiManaged: !!r.is_ai_managed,
    riskLevel: r.risk_level,
    tradingStyle: r.trading_style,
  };
}

export async function getProfiles(): Promise<Profile[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ProfileRow>(
    'SELECT id, name, starting_cash, cash_balance, created_at, is_ai_managed, risk_level, trading_style FROM profiles ORDER BY created_at ASC'
  );
  return rows.map(mapProfileRow);
}

export async function getProfileById(profileId: number): Promise<Profile | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ProfileRow>(
    'SELECT id, name, starting_cash, cash_balance, created_at, is_ai_managed, risk_level, trading_style FROM profiles WHERE id = ?',
    profileId
  );
  return row ? mapProfileRow(row) : null;
}

export async function getActiveProfileId(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_state WHERE key = ?', ACTIVE_PROFILE_KEY);
  if (row) return Number(row.value);

  const first = await db.getFirstAsync<{ id: number }>('SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1');
  if (!first) throw new Error('No paper trading profiles exist.');
  await setActiveProfileIdOnDb(db, first.id);
  return first.id;
}

export async function getActiveProfile(): Promise<Profile> {
  const [profiles, activeId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  const active = profiles.find((p) => p.id === activeId);
  if (!active) throw new Error('Active profile could not be found.');
  return active;
}

export async function setActiveProfileId(profileId: number): Promise<void> {
  const db = await getDb();
  await setActiveProfileIdOnDb(db, profileId);
}

/** Creates a new paper trading save with its own starting cash, and makes it the active profile. */
export async function createProfile(
  name: string,
  startingCash: number,
  isAiManaged = false,
  riskLevel: AiRiskLevel = 'MODERATE',
  tradingStyle: AiTradingStyle = 'STANDARD'
): Promise<Profile> {
  const db = await getDb();
  const id = await insertProfile(db, name.trim() || 'New save', startingCash, startingCash, isAiManaged, riskLevel, tradingStyle);
  await setActiveProfileIdOnDb(db, id);
  return {
    id,
    name: name.trim() || 'New save',
    startingCash,
    cashBalance: startingCash,
    createdAt: Date.now(),
    isAiManaged,
    riskLevel,
    tradingStyle,
  };
}

export async function deleteProfile(profileId: number): Promise<void> {
  const db = await getDb();
  const { count } = (await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM profiles')) ?? { count: 0 };
  if (count <= 1) {
    throw new Error('Cannot delete your only save. Create another one first.');
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM positions WHERE profile_id = ?', profileId);
    await db.runAsync('DELETE FROM trades WHERE profile_id = ?', profileId);
    await db.runAsync('DELETE FROM profiles WHERE id = ?', profileId);

    const activeId = await getActiveProfileId();
    if (activeId === profileId) {
      const fallback = await db.getFirstAsync<{ id: number }>('SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1');
      if (fallback) await setActiveProfileIdOnDb(db, fallback.id);
    }
  });
}

// --- Generic app-state key/value storage (remembered UI preferences, onboarding flags, etc.) ---

export async function getAppStateValue(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_state WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setAppStateValue(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, value
  );
}

export async function renameProfile(profileId: number, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE profiles SET name = ? WHERE id = ?', name.trim() || 'Untitled save', profileId);
}

// --- Watchlist (shared across all profiles) ---

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

// --- Paper trading: cash, positions, trades (all scoped to a profile) ---

export async function getCashBalance(profileId?: number): Promise<number> {
  const db = await getDb();
  const id = profileId ?? (await getActiveProfileId());
  const row = await db.getFirstAsync<{ cash_balance: number }>('SELECT cash_balance FROM profiles WHERE id = ?', id);
  return row?.cash_balance ?? 0;
}

export async function getPositions(profileId?: number): Promise<Position[]> {
  const db = await getDb();
  const id = profileId ?? (await getActiveProfileId());
  const rows = await db.getAllAsync<{ symbol: string; quantity: number; avg_cost: number }>(
    'SELECT symbol, quantity, avg_cost FROM positions WHERE profile_id = ? ORDER BY symbol ASC',
    id
  );
  return rows.map((r) => ({ symbol: r.symbol, quantity: r.quantity, avgCost: r.avg_cost }));
}

export async function getPosition(symbol: string, profileId?: number): Promise<Position | null> {
  const db = await getDb();
  const id = profileId ?? (await getActiveProfileId());
  const row = await db.getFirstAsync<{ symbol: string; quantity: number; avg_cost: number }>(
    'SELECT symbol, quantity, avg_cost FROM positions WHERE profile_id = ? AND symbol = ?',
    id, symbol.toUpperCase()
  );
  return row ? { symbol: row.symbol, quantity: row.quantity, avgCost: row.avg_cost } : null;
}

export async function getTrades(mode?: TradeMode, profileId?: number): Promise<Trade[]> {
  const db = await getDb();
  let rows: any[];
  if (mode === 'PAPER') {
    const id = profileId ?? (await getActiveProfileId());
    rows = await db.getAllAsync<any>(
      'SELECT * FROM trades WHERE mode = ? AND profile_id = ? ORDER BY timestamp DESC',
      'PAPER', id
    );
  } else if (mode) {
    rows = await db.getAllAsync<any>('SELECT * FROM trades WHERE mode = ? ORDER BY timestamp DESC', mode);
  } else {
    rows = await db.getAllAsync<any>('SELECT * FROM trades ORDER BY timestamp DESC');
  }
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

/** Records a filled paper trade against a profile: adjusts its cash and weighted-average position cost. */
export async function recordPaperTrade(symbol: string, side: TradeSide, quantity: number, price: number, profileId?: number): Promise<void> {
  const db = await getDb();
  const id = profileId ?? (await getActiveProfileId());
  const upperSymbol = symbol.toUpperCase();
  const cost = quantity * price;

  await db.withTransactionAsync(async () => {
    const profileRow = await db.getFirstAsync<{ cash_balance: number }>('SELECT cash_balance FROM profiles WHERE id = ?', id);
    const cash = profileRow?.cash_balance ?? 0;
    const existing = await db.getFirstAsync<{ quantity: number; avg_cost: number }>(
      'SELECT quantity, avg_cost FROM positions WHERE profile_id = ? AND symbol = ?',
      id, upperSymbol
    );

    if (side === 'BUY') {
      if (cost > cash) throw new Error('Insufficient paper cash balance for this purchase.');
      const newQuantity = (existing?.quantity ?? 0) + quantity;
      const newAvgCost = existing
        ? (existing.avg_cost * existing.quantity + cost) / newQuantity
        : price;
      await db.runAsync(
        'INSERT INTO positions (profile_id, symbol, quantity, avg_cost) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, symbol) DO UPDATE SET quantity = ?, avg_cost = ?',
        id, upperSymbol, newQuantity, newAvgCost, newQuantity, newAvgCost
      );
      await db.runAsync('UPDATE profiles SET cash_balance = ? WHERE id = ?', cash - cost, id);
    } else {
      const held = existing?.quantity ?? 0;
      if (quantity > held) throw new Error('Cannot sell more shares than you hold in this save.');
      const remaining = held - quantity;
      if (remaining <= 0) {
        await db.runAsync('DELETE FROM positions WHERE profile_id = ? AND symbol = ?', id, upperSymbol);
      } else {
        await db.runAsync('UPDATE positions SET quantity = ? WHERE profile_id = ? AND symbol = ?', remaining, id, upperSymbol);
      }
      await db.runAsync('UPDATE profiles SET cash_balance = ? WHERE id = ?', cash + cost, id);
    }

    await db.runAsync(
      'INSERT INTO trades (profile_id, symbol, side, quantity, price, timestamp, mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, upperSymbol, side, quantity, price, Date.now(), 'PAPER'
    );
  });
}

/** Records a live trade fill for history purposes only (Alpaca is the source of truth for real positions/cash). */
export async function recordLiveTrade(symbol: string, side: TradeSide, quantity: number, price: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO trades (profile_id, symbol, side, quantity, price, timestamp, mode) VALUES (NULL, ?, ?, ?, ?, ?, ?)',
    symbol.toUpperCase(), side, quantity, price, Date.now(), 'LIVE'
  );
}

/** Resets a profile back to its own starting cash and clears its positions/trade history. */
export async function resetPaperAccount(profileId?: number): Promise<void> {
  const db = await getDb();
  const id = profileId ?? (await getActiveProfileId());
  await db.withTransactionAsync(async () => {
    const profileRow = await db.getFirstAsync<{ starting_cash: number }>('SELECT starting_cash FROM profiles WHERE id = ?', id);
    await db.runAsync('DELETE FROM positions WHERE profile_id = ?', id);
    await db.runAsync('DELETE FROM trades WHERE profile_id = ? AND mode = ?', id, 'PAPER');
    await db.runAsync('UPDATE profiles SET cash_balance = ? WHERE id = ?', profileRow?.starting_cash ?? DEFAULT_STARTING_CASH, id);
  });
}

// --- Price/signal alerts ---

function mapAlertRow(r: any): Alert {
  return {
    id: r.id,
    symbol: r.symbol,
    type: r.type,
    threshold: r.threshold,
    createdAt: r.created_at,
    triggeredAt: r.triggered_at,
  };
}

export async function getAlerts(): Promise<Alert[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM alerts ORDER BY created_at DESC');
  return rows.map(mapAlertRow);
}

export async function getAlertsForSymbol(symbol: string): Promise<Alert[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM alerts WHERE symbol = ? ORDER BY created_at DESC', symbol.toUpperCase());
  return rows.map(mapAlertRow);
}

export async function createAlert(symbol: string, type: AlertType, threshold: number | null): Promise<Alert> {
  const db = await getDb();
  const createdAt = Date.now();
  const result = await db.runAsync(
    'INSERT INTO alerts (symbol, type, threshold, created_at, triggered_at) VALUES (?, ?, ?, ?, NULL)',
    symbol.toUpperCase(), type, threshold, createdAt
  );
  return { id: result.lastInsertRowId, symbol: symbol.toUpperCase(), type, threshold, createdAt, triggeredAt: null };
}

export async function deleteAlert(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM alerts WHERE id = ?', id);
}

export async function markAlertTriggered(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE alerts SET triggered_at = ? WHERE id = ?', Date.now(), id);
}

export async function resetAlert(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE alerts SET triggered_at = NULL WHERE id = ?', id);
}

// --- Signal track record (logs signals over time so we can check whether they were right) ---

export type SignalLogEntry = {
  id: number;
  symbol: string;
  score: SignalScore;
  points: number;
  price: number;
  loggedAt: number;
};

/** Logs a signal snapshot at most once per symbol per calendar day. */
export async function logSignalIfNew(symbol: string, score: SignalScore, points: number, price: number): Promise<void> {
  const db = await getDb();
  const upperSymbol = symbol.toUpperCase();
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM signal_log WHERE symbol = ? AND logged_at >= ? LIMIT 1',
    upperSymbol, dayStart
  );
  if (existing) return;
  await db.runAsync(
    'INSERT INTO signal_log (symbol, score, points, price, logged_at) VALUES (?, ?, ?, ?, ?)',
    upperSymbol, score, points, price, Date.now()
  );
}

export async function getSignalLog(limit = 500): Promise<SignalLogEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM signal_log ORDER BY logged_at DESC LIMIT ?', limit);
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    score: r.score,
    points: r.points,
    price: r.price,
    loggedAt: r.logged_at,
  }));
}

// --- AI-managed saves: logs each autonomous trading round for transparency/review ---

export async function logAiDecisionRound(
  profileId: number,
  summary: string,
  rawResponse: string | null,
  actions: AiTradeAction[]
): Promise<AiDecisionRound> {
  const db = await getDb();
  const timestamp = Date.now();
  const actionsJson = JSON.stringify(actions);
  const result = await db.runAsync(
    'INSERT INTO ai_decisions (profile_id, timestamp, summary, raw_response, actions_json) VALUES (?, ?, ?, ?, ?)',
    profileId, timestamp, summary, rawResponse, actionsJson
  );
  return { id: result.lastInsertRowId, profileId, timestamp, summary, actions, rawResponse };
}

export async function getAiDecisionLog(profileId: number, limit = 20): Promise<AiDecisionRound[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM ai_decisions WHERE profile_id = ? ORDER BY timestamp DESC LIMIT ?',
    profileId, limit
  );
  return rows.map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    timestamp: r.timestamp,
    summary: r.summary,
    actions: JSON.parse(r.actions_json) as AiTradeAction[],
    rawResponse: r.raw_response ?? null,
  }));
}

// --- Full US-listed-symbol master list (search/discovery breadth beyond curated + screener lists) ---

export type ListedSymbolRow = { symbol: string; name: string; exchange: string };

export async function getListedSymbolsCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM listed_symbols');
  return row?.count ?? 0;
}

/** Replaces the entire cached symbol directory in one transaction — this is a full refresh, not an incremental update. */
export async function replaceListedSymbols(rows: ListedSymbolRow[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM listed_symbols');
    for (const r of rows) {
      await db.runAsync('INSERT OR REPLACE INTO listed_symbols (symbol, name, exchange) VALUES (?, ?, ?)', r.symbol, r.name, r.exchange);
    }
  });
}

/** Symbol-prefix or company-name substring search across the full cached market directory. */
export async function searchListedSymbols(query: string, limit = 8): Promise<ListedSymbolRow[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const db = await getDb();
  const upper = trimmed.toUpperCase();
  return db.getAllAsync<ListedSymbolRow>(
    `SELECT symbol, name, exchange FROM listed_symbols
     WHERE symbol LIKE ?1 OR name LIKE ?2
     ORDER BY (CASE WHEN symbol = ?3 THEN 0 WHEN symbol LIKE ?1 THEN 1 ELSE 2 END), LENGTH(symbol) ASC
     LIMIT ?4`,
    `${upper}%`, `%${trimmed}%`, upper, limit
  );
}

/** A random sample from the full market directory, so discovery isn't limited to symbols that are already popular enough to show up on a trending/gainers/curated list. */
export async function getRandomListedSymbols(count: number): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ symbol: string }>('SELECT symbol FROM listed_symbols ORDER BY RANDOM() LIMIT ?', count);
  return rows.map((r) => r.symbol);
}
