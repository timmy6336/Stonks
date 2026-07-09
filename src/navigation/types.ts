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
};

export type SettingsStackParamList = {
  Settings: undefined;
  HowItWorks: undefined;
  SignalTrackRecord: undefined;
};

export type RootTabParamList = {
  WatchlistTab: undefined;
  TrendingTab: undefined;
  PortfolioTab: undefined;
  SettingsTab: undefined;
};
