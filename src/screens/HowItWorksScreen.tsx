import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';

type Section = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

const SECTIONS: Section[] = [
  {
    icon: 'server-outline',
    title: 'No backend, no account required',
    body:
      'Stonks runs entirely on your device. Prices, charts, and news come directly from public Yahoo Finance endpoints — there is no Stonks server collecting or storing your data.',
  },
  {
    icon: 'bulb-outline',
    title: 'How the signal is computed',
    body:
      'Each score (STRONG BUY through STRONG SELL) is a simple rule-based points system built from four indicators: the 20/50-day moving average crossover, 14-day RSI, MACD, and a volume spike check. It is not a prediction, and definitely not financial advice.',
  },
  {
    icon: 'analytics-outline',
    title: 'Trend projection',
    body:
      "The projection shown on a stock's page is a naive linear extrapolation of its recent closing prices — it assumes the recent trend continues in a straight line, which real markets rarely do.",
  },
  {
    icon: 'flask-outline',
    title: 'Backtest',
    body:
      'The backtest replays the signal day-by-day over the stock\'s recent history and compares it to simply buying and holding. One stock over one window proves very little; use it as a sanity check, not evidence the signal works in general.',
  },
  {
    icon: 'wallet-outline',
    title: 'Paper trading',
    body:
      'By default, all Buy/Sell actions use simulated cash tracked only on your device. Create multiple "saves" with different starting balances from the Portfolio tab to compare strategies.',
  },
  {
    icon: 'flash-outline',
    title: 'Live trading (optional)',
    body:
      'If you add your own Alpaca API keys in Settings and turn on Live trading, Buy/Sell actions place real orders through your Alpaca brokerage account using real money. This is entirely optional and off by default.',
  },
  {
    icon: 'sparkles-outline',
    title: 'AI insights (optional)',
    body:
      "If you add your own free Gemini API key in Settings, the stock detail page can generate a short plain-English summary using Google's Gemini API. Your key is stored only on this device and used only to call Google's API directly.",
  },
  {
    icon: 'notifications-outline',
    title: 'Alerts & daily digest',
    body:
      'Alerts and the daily digest are checked while the app is open (or just launched) — there is no true background push, since that would require a server. Open the app periodically to make sure you do not miss anything.',
  },
  {
    icon: 'stats-chart-outline',
    title: 'Signal track record',
    body:
      "Every signal computed for a stock you're tracking is logged once per day. After a day has passed, we check whether the price actually moved the way the call implied, and show the running accuracy in Settings.",
  },
];

export function HowItWorksScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      {SECTIONS.map((s) => (
        <View key={s.title} style={styles.card}>
          <View style={styles.titleRow}>
            <Ionicons name={s.icon} size={18} color={colors.accent} />
            <Text style={styles.title}>{s.title}</Text>
          </View>
          <Text style={styles.body}>{s.body}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    title: { fontWeight: '700', color: colors.text, fontSize: 15, flexShrink: 1 },
    body: { color: colors.textSecondary, lineHeight: 20 },
  });
}
