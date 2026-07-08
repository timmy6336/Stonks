import type { Ionicons } from '@expo/vector-icons';

export type StockCategory = {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  symbols: string[];
};

/**
 * Hand-curated theme groupings for browsing (not an official sector/industry
 * classification). Tickers can change business focus or get delisted over
 * time, so this list is meant as a reasonable starting point, not a
 * guarantee of relevance.
 */
export const STOCK_CATEGORIES: StockCategory[] = [
  { id: 'space', name: 'Space & Aerospace', icon: 'rocket', symbols: ['RKLB', 'LMT', 'NOC', 'BA', 'RTX', 'ASTS', 'IRDM', 'GD'] },
  { id: 'energy', name: 'Oil & Energy', icon: 'flame', symbols: ['XOM', 'CVX', 'COP', 'OXY', 'SLB', 'PSX', 'VLO', 'MPC'] },
  { id: 'sports', name: 'Sports & Apparel', icon: 'basketball', symbols: ['NKE', 'DKNG', 'LULU', 'UAA', 'FL', 'PTON', 'ADDYY'] },
  { id: 'tech', name: 'Big Tech', icon: 'hardware-chip', symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'ORCL', 'CRM'] },
  { id: 'ev', name: 'Electric Vehicles', icon: 'car-sport', symbols: ['TSLA', 'RIVN', 'LCID', 'NIO', 'GM', 'F', 'XPEV', 'LI'] },
  { id: 'finance', name: 'Banking & Finance', icon: 'business', symbols: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'AXP', 'SCHW'] },
  { id: 'healthcare', name: 'Healthcare & Pharma', icon: 'medkit', symbols: ['JNJ', 'PFE', 'UNH', 'MRK', 'ABBV', 'LLY', 'CVS', 'MRNA'] },
  { id: 'semiconductors', name: 'Semiconductors', icon: 'hardware-chip-outline', symbols: ['NVDA', 'AMD', 'INTC', 'TSM', 'QCOM', 'AVGO', 'MU', 'TXN'] },
  { id: 'crypto', name: 'Crypto & Fintech', icon: 'logo-bitcoin', symbols: ['COIN', 'MSTR', 'SQ', 'PYPL', 'HOOD', 'MARA', 'RIOT', 'SOFI'] },
];
