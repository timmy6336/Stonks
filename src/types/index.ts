export type Candle = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Quote = {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  marketTime: number;
};

export type SignalScore = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export type Signal = {
  symbol: string;
  score: SignalScore;
  points: number;
  reasons: string[];
  computedAt: number;
};

export type WatchlistItem = {
  symbol: string;
  addedAt: number;
};

export type CompanyProfile = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  summary: string | null;
  website: string | null;
  employees: number | null;
};

export type AlertType = 'PRICE_ABOVE' | 'PRICE_BELOW' | 'SIGNAL_BUY_OR_BETTER' | 'SIGNAL_STRONG_BUY';

export type Alert = {
  id: number;
  symbol: string;
  type: AlertType;
  threshold: number | null;
  createdAt: number;
  triggeredAt: number | null;
};

export type Profile = {
  id: number;
  name: string;
  startingCash: number;
  cashBalance: number;
  createdAt: number;
};

export type Position = {
  symbol: string;
  quantity: number;
  avgCost: number;
};

export type TradeSide = 'BUY' | 'SELL';
export type TradeMode = 'PAPER' | 'LIVE';

export type Trade = {
  id: number;
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  timestamp: number;
  mode: TradeMode;
};

export type TradingMode = 'PAPER' | 'LIVE';
