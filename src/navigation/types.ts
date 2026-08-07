import type { AiDecisionRound } from '../types';

export type StockDetailParams = { symbol: string };

export type WatchlistStackParamList = {
  Watchlist: undefined;
  StockDetail: StockDetailParams;
  Alerts: undefined;
};

export type TrendingStackParamList = {
  Trending: undefined;
  StockDetail: StockDetailParams;
  Compare: undefined;
};

export type PortfolioStackParamList = {
  Portfolio: undefined;
  Profiles: undefined;
  AiDecisionDetail: { round: AiDecisionRound; profileName: string; riskLevel: string };
};

export type DailyPicksStackParamList = {
  DailyPicks: undefined;
  StockDetail: StockDetailParams;
};

export type SettingsStackParamList = {
  Settings: undefined;
  HowItWorks: undefined;
  SignalTrackRecord: undefined;
};

export type RootTabParamList = {
  WatchlistTab: undefined;
  TrendingTab: undefined;
  DailyPicksTab: undefined;
  PortfolioTab: undefined;
  SettingsTab: undefined;
};
