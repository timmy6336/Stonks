import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-chart-kit';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PortfolioStackParamList } from '../navigation/types';
import {
  getActiveProfile,
  getAiDecisionLog,
  getAppStateValue,
  getPositions,
  getTrades,
  resetPaperAccount,
  setAppStateValue,
} from '../db/database';
import { fetchQuote } from '../api/marketData';
import {
  computePortfolioPerformance,
  selectPointsForWindow,
  type PerformanceWindow,
  type PortfolioPerformance,
} from '../portfolio/portfolioHistory';
import { runAiTradingRound } from '../ai/aiTrader';
import { STOCK_CATEGORIES } from '../data/categories';
import { useTheme } from '../theme/ThemeContext';
import { hexToRgba, type ThemeColors } from '../theme/theme';
import type { AiDecisionRound, Position, Profile, Trade } from '../types';

const CATEGORY_COLORS = ['#0a7d32', '#3fa34d', '#7cb342', '#d9822b', '#c0392b', '#8e44ad', '#2980b9', '#16a085', '#999'];

// How often an AI-managed save re-trades while this screen is open. There's no background
// execution in this app, so consistency is bounded by how long the user keeps it open.
const AI_RUN_INTERVAL_KEY = 'ai_run_interval_minutes';
const DEFAULT_AI_RUN_INTERVAL_MINUTES = 60;
const AI_RUN_INTERVAL_OPTIONS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hr' },
  { minutes: 120, label: '2 hr' },
  { minutes: 240, label: '4 hr' },
];

const CHART_WINDOW_KEY = 'portfolio_chart_window';
const CHART_WINDOWS: { key: PerformanceWindow; label: string }[] = [
  { key: 'DAILY', label: 'Daily' },
  { key: 'WEEKLY', label: 'Weekly' },
  { key: 'MONTHLY', label: 'Monthly' },
  { key: 'YEARLY', label: 'Yearly' },
];

function categoryFor(symbol: string): string {
  const match = STOCK_CATEGORIES.find((c) => c.symbols.includes(symbol));
  return match?.name ?? 'Other';
}

function buildCategoryBreakdown(positions: { symbol: string; value: number }[]) {
  const totals = new Map<string, number>();
  for (const p of positions) {
    const category = categoryFor(p.symbol);
    totals.set(category, (totals.get(category) ?? 0) + p.value);
  }
  const grandTotal = positions.reduce((sum, p) => sum + p.value, 0);
  return Array.from(totals.entries())
    .map(([name, value]) => ({ name, value, percent: grandTotal > 0 ? (value / grandTotal) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

type PositionRow = Position & { currentPrice?: number };
type Props = NativeStackScreenProps<PortfolioStackParamList, 'Portfolio'>;

export function PortfolioScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [performance, setPerformance] = useState<PortfolioPerformance | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chartWindow, setChartWindowState] = useState<PerformanceWindow>('WEEKLY');
  const [aiLog, setAiLog] = useState<AiDecisionRound[]>([]);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiRunIntervalMinutes, setAiRunIntervalMinutesState] = useState(DEFAULT_AI_RUN_INTERVAL_MINUTES);

  useEffect(() => {
    getAppStateValue(CHART_WINDOW_KEY).then((saved) => {
      if (saved && CHART_WINDOWS.some((w) => w.key === saved)) {
        setChartWindowState(saved as PerformanceWindow);
      }
    });
    getAppStateValue(AI_RUN_INTERVAL_KEY).then((saved) => {
      const minutes = Number(saved);
      if (saved && AI_RUN_INTERVAL_OPTIONS.some((o) => o.minutes === minutes)) {
        setAiRunIntervalMinutesState(minutes);
      }
    });
  }, []);

  const setAiRunIntervalMinutes = (minutes: number) => {
    setAiRunIntervalMinutesState(minutes);
    setAppStateValue(AI_RUN_INTERVAL_KEY, String(minutes)).catch(() => {});
  };

  const setChartWindow = (window: PerformanceWindow) => {
    setChartWindowState(window);
    setAppStateValue(CHART_WINDOW_KEY, window).catch(() => {});
  };

  const load = useCallback(async () => {
    setLoading(true);
    setPerformanceLoading(true);
    const [activeProfile, pos, tradeHistory] = await Promise.all([
      getActiveProfile(),
      getPositions(),
      getTrades('PAPER'),
    ]);
    setProfile(activeProfile);
    setTrades(tradeHistory);
    setPositions(pos);
    setAiLog(activeProfile.isAiManaged ? await getAiDecisionLog(activeProfile.id, 10) : []);
    setLoading(false);

    const priceBySymbol: Record<string, number> = {};
    await Promise.all(
      pos.map(async (p) => {
        try {
          const q = await fetchQuote(p.symbol);
          priceBySymbol[p.symbol] = q.price;
          setPositions((prev) => prev.map((row) => (row.symbol === p.symbol ? { ...row, currentPrice: q.price } : row)));
        } catch {
          // leave currentPrice unset if the quote fails; UI shows cost basis only
        }
      })
    );

    try {
      const perf = await computePortfolioPerformance(
        activeProfile.id,
        activeProfile.startingCash,
        activeProfile.cashBalance,
        pos.map((p) => ({ symbol: p.symbol, quantity: p.quantity })),
        priceBySymbol
      );
      setPerformance(perf);
    } catch {
      setPerformance(null); // performance history is a nice-to-have; don't block the rest of the screen on it
    } finally {
      setPerformanceLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleRunAiRound = useCallback(
    async (profileId: number) => {
      setAiRunning(true);
      try {
        await runAiTradingRound(profileId);
      } finally {
        setAiRunning(false);
        await load();
      }
    },
    [load]
  );

  // Auto-run on an interval for AI-managed saves whenever this screen is open/focused, so the
  // experiment trades far more consistently than once a day without needing true background
  // execution (which this app, with no server and no native background task, can't do).
  useEffect(() => {
    if (loading || aiRunning || !profile?.isAiManaged) return;
    const lastRun = aiLog[0]?.timestamp ?? 0;
    if (Date.now() - lastRun >= aiRunIntervalMinutes * 60 * 1000) {
      handleRunAiRound(profile.id);
    }
  }, [loading, aiRunning, profile, aiLog, aiRunIntervalMinutes, handleRunAiRound]);

  // While this screen stays open, keep nudging another round on the same interval rather than only
  // checking once at focus time.
  useEffect(() => {
    if (!profile?.isAiManaged) return;
    const timer = setInterval(() => {
      if (!aiRunning) handleRunAiRound(profile.id);
    }, aiRunIntervalMinutes * 60 * 1000);
    return () => clearInterval(timer);
  }, [profile, aiRunning, aiRunIntervalMinutes, handleRunAiRound]);

  const cash = profile?.cashBalance ?? 0;
  const marketValue = positions.reduce((sum, p) => sum + (p.currentPrice ?? p.avgCost) * p.quantity, 0);
  const totalValue = cash + marketValue;
  const chartPoints = useMemo(
    () => (performance ? selectPointsForWindow(performance.points, chartWindow) : []),
    [performance, chartWindow]
  );
  // react-native-chart-kit can't draw a line from a single point, so pad a lone bucket into a flat line.
  const chartValues = chartPoints.length > 1 ? chartPoints.map((p) => p.value) : [chartPoints[0]?.value ?? 0, chartPoints[0]?.value ?? 0];
  const categoryBreakdown = buildCategoryBreakdown(
    positions.map((p) => ({ symbol: p.symbol, value: (p.currentPrice ?? p.avgCost) * p.quantity }))
  );

  const handleReset = () => {
    Alert.alert(
      'Reset this save?',
      `This clears all simulated positions and trade history and resets cash to $${(profile?.startingCash ?? 0).toFixed(2)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetPaperAccount();
            await load();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      data={positions}
      keyExtractor={(p) => p.symbol}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      ListHeaderComponent={
        <>
          <Pressable style={styles.saveRow} onPress={() => navigation.navigate('Profiles')}>
            <View style={styles.saveLabelRow}>
              <Ionicons name="albums" size={16} color={colors.text} />
              <Text style={styles.saveLabel}>Save: {profile?.name ?? ''}</Text>
            </View>
            <View style={styles.saveLabelRow}>
              <Text style={styles.saveManage}>Manage saves</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.accent} />
            </View>
          </Pressable>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total paper portfolio value</Text>
            <Text style={styles.summaryValue}>${totalValue.toFixed(2)}</Text>
            <Text style={styles.summarySub}>Cash: ${cash.toFixed(2)}   Invested: ${marketValue.toFixed(2)}</Text>
          </View>

          {profile?.isAiManaged && (
            <View style={styles.aiCard}>
              <View style={styles.sectionHeader}>
                <Ionicons name="sparkles" size={16} color={colors.accent} />
                <Text style={styles.sectionTitle}>AI Trader</Text>
              </View>
              <Text style={styles.aiHint}>
                This save trades on its own on the interval below while this screen is open, using your active AI
                provider — no manual buy/sell. There's no background execution, so keep the app open (or check back
                often) for it to run consistently. An experiment: watch the log below to see how it does.
              </Text>
              <View style={styles.aiIntervalRow}>
                {AI_RUN_INTERVAL_OPTIONS.map((o) => (
                  <Pressable
                    key={o.minutes}
                    style={[styles.aiIntervalChip, aiRunIntervalMinutes === o.minutes && styles.aiIntervalChipSelected]}
                    onPress={() => setAiRunIntervalMinutes(o.minutes)}
                  >
                    <Text
                      style={[
                        styles.aiIntervalChipText,
                        aiRunIntervalMinutes === o.minutes && styles.aiIntervalChipTextSelected,
                      ]}
                    >
                      {o.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                style={styles.aiRunButton}
                onPress={() => profile && handleRunAiRound(profile.id)}
                disabled={aiRunning}
              >
                {aiRunning ? (
                  <>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.aiRunButtonText}>Thinking…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="play" size={16} color="#fff" />
                    <Text style={styles.aiRunButtonText}>Run AI round now</Text>
                  </>
                )}
              </Pressable>
              {aiLog.length === 0 ? (
                <Text style={styles.aiEmptyText}>No rounds run yet.</Text>
              ) : (
                aiLog.slice(0, 5).map((round) => (
                  <View key={round.id} style={styles.aiRound}>
                    <Text style={styles.aiRoundDate}>{new Date(round.timestamp).toLocaleString()}</Text>
                    <Text style={styles.aiRoundSummary}>{round.summary}</Text>
                    {round.actions.length === 0 ? (
                      <Text style={styles.aiActionNone}>No trades this round.</Text>
                    ) : (
                      round.actions.map((a, i) => (
                        <View key={i} style={styles.aiActionRow}>
                          <Ionicons
                            name={a.action === 'BUY' ? 'arrow-up-circle' : 'arrow-down-circle'}
                            size={14}
                            color={a.executed ? (a.action === 'BUY' ? colors.accent : colors.danger) : colors.textMuted}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.aiActionText}>
                              {a.action} {a.quantity} {a.symbol}
                              {!a.executed ? ' — skipped' : ''}
                            </Text>
                            <Text style={styles.aiActionReason}>{a.executed ? a.reasoning : a.error ?? a.reasoning}</Text>
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                ))
              )}
            </View>
          )}

          <View style={styles.sectionHeader}>
            <Ionicons name="stats-chart" size={16} color={colors.accent} />
            <Text style={styles.sectionTitle}>Performance</Text>
          </View>
          {performanceLoading && !performance ? (
            <ActivityIndicator style={{ marginVertical: 12 }} />
          ) : performance && performance.points.length > 1 ? (
            <>
              <View style={styles.windowRow}>
                {CHART_WINDOWS.map((w) => (
                  <Pressable
                    key={w.key}
                    style={[styles.windowChip, chartWindow === w.key && styles.windowChipSelected]}
                    onPress={() => setChartWindow(w.key)}
                  >
                    <Text style={[styles.windowChipText, chartWindow === w.key && styles.windowChipTextSelected]}>
                      {w.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <LineChart
                data={{
                  labels: [],
                  datasets: [{ data: chartValues }],
                }}
                width={Dimensions.get('window').width - 32}
                height={140}
                withDots={false}
                withInnerLines={false}
                withHorizontalLabels
                withVerticalLabels={false}
                chartConfig={{
                  backgroundGradientFrom: colors.card,
                  backgroundGradientTo: colors.card,
                  color: (opacity = 1) => hexToRgba(colors.accent, opacity),
                  labelColor: () => colors.text,
                  decimalPlaces: 0,
                }}
                bezier
                style={{ marginBottom: 12, borderRadius: 12 }}
              />
              <View style={styles.periodRow}>
                {performance.periods.map((p) => (
                  <View key={p.label} style={styles.periodCard}>
                    <Text style={styles.periodLabel}>{p.label}</Text>
                    <View style={styles.periodChangeRow}>
                      <Ionicons
                        name={p.changePercent >= 0 ? 'caret-up' : 'caret-down'}
                        size={14}
                        color={p.changePercent >= 0 ? colors.accent : colors.danger}
                      />
                      <Text style={[styles.periodPercent, { color: p.changePercent >= 0 ? colors.accent : colors.danger }]}>
                        {p.changePercent >= 0 ? '+' : ''}
                        {p.changePercent.toFixed(2)}%
                      </Text>
                    </View>
                    <Text style={styles.periodAmount}>
                      {p.changeAmount >= 0 ? '+' : ''}${p.changeAmount.toFixed(2)}
                    </Text>
                    <Text style={styles.periodSub}>
                      {p.startLabel === "Today's open" ? "Today's open" : p.startLabel.split(' (')[0]}: ${p.startValue.toFixed(2)}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.emptyText}>Buy something to start tracking performance over time.</Text>
          )}

          {categoryBreakdown.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Ionicons name="apps" size={16} color={colors.accent} />
                <Text style={styles.sectionTitle}>Diversification</Text>
              </View>
              <View style={styles.diversificationCard}>
                {categoryBreakdown.map((c, i) => (
                  <View key={c.name} style={styles.diversificationRow}>
                    <View style={[styles.diversificationDot, { backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }]} />
                    <Text style={styles.diversificationName}>{c.name}</Text>
                    <Text style={styles.diversificationPercent}>{c.percent.toFixed(0)}%</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={styles.sectionHeader}>
            <Ionicons name="pie-chart" size={16} color={colors.accent} />
            <Text style={styles.sectionTitle}>Positions</Text>
          </View>
        </>
      }
      renderItem={({ item }) => {
        const pl = item.currentPrice !== undefined ? (item.currentPrice - item.avgCost) * item.quantity : undefined;
        return (
          <View style={styles.row}>
            <View>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <Text style={styles.sub}>{item.quantity} shares @ avg ${item.avgCost.toFixed(2)}</Text>
            </View>
            {pl !== undefined && (
              <Text style={{ color: pl >= 0 ? colors.accent : colors.danger, fontWeight: '600' }}>
                {pl >= 0 ? '+' : ''}${pl.toFixed(2)}
              </Text>
            )}
          </View>
        );
      }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="file-tray-outline" size={24} color={colors.textMuted} />
          <Text style={styles.emptyText}>No open paper positions yet.</Text>
        </View>
      }
      ListFooterComponent={
        <>
          <View style={styles.sectionHeader}>
            <Ionicons name="receipt" size={16} color={colors.accent} />
            <Text style={styles.sectionTitle}>Recent trades</Text>
          </View>
          {trades.slice(0, 20).map((t) => (
            <View key={t.id} style={styles.row}>
              <View style={styles.tradeRow}>
                <Ionicons
                  name={t.side === 'BUY' ? 'arrow-up-circle' : 'arrow-down-circle'}
                  size={16}
                  color={t.side === 'BUY' ? colors.accent : colors.danger}
                />
                <Text style={{ color: colors.text }}>
                  {t.side} {t.quantity} {t.symbol} @ ${t.price.toFixed(2)}
                </Text>
              </View>
              <Text style={styles.sub}>{new Date(t.timestamp).toLocaleDateString()}</Text>
            </View>
          ))}
          <Pressable style={styles.resetButton} onPress={handleReset}>
            <Ionicons name="refresh" size={16} color={colors.danger} />
            <Text style={styles.resetText}>Reset this save</Text>
          </Pressable>
        </>
      }
    />
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    saveRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    saveLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    saveLabel: { fontWeight: '700', fontSize: 15, color: colors.text },
    saveManage: { color: colors.accent, fontWeight: '600' },
    summaryCard: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 16 },
    summaryLabel: { color: colors.textSecondary },
    summaryValue: { fontSize: 28, fontWeight: '700', marginTop: 4, color: colors.text },
    summarySub: { marginTop: 6, color: colors.textSecondary },
    aiCard: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 16 },
    aiHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 10 },
    aiIntervalRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
    aiIntervalChip: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.chipBackground,
    },
    aiIntervalChipSelected: { backgroundColor: colors.accent },
    aiIntervalChipText: { color: colors.text, fontWeight: '600', fontSize: 11, includeFontPadding: false },
    aiIntervalChipTextSelected: { color: '#fff' },
    aiRunButton: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingVertical: 10,
      marginBottom: 10,
    },
    aiRunButtonText: { color: '#fff', fontWeight: '700', includeFontPadding: false },
    aiEmptyText: { color: colors.textMuted, fontSize: 12 },
    aiRound: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    aiRoundDate: { color: colors.textMuted, fontSize: 11 },
    aiRoundSummary: { color: colors.text, fontSize: 13, marginTop: 3, marginBottom: 6 },
    aiActionNone: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
    aiActionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
    aiActionText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    aiActionReason: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 8 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    tradeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    symbol: { fontWeight: '700', color: colors.text },
    sub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    windowRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    windowChip: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 7,
      borderRadius: 8,
      backgroundColor: colors.chipBackground,
    },
    windowChipSelected: { backgroundColor: colors.accent },
    windowChipText: { color: colors.text, fontWeight: '600', fontSize: 12, includeFontPadding: false },
    windowChipTextSelected: { color: '#fff' },
    periodRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
    periodCard: { flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 10 },
    periodLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
    periodChangeRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
    periodPercent: { fontWeight: '700', fontSize: 15 },
    periodAmount: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    periodSub: { fontSize: 10, color: colors.textMuted, marginTop: 4 },
    diversificationCard: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 16 },
    diversificationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
    diversificationDot: { width: 10, height: 10, borderRadius: 5 },
    diversificationName: { flex: 1, color: colors.text },
    diversificationPercent: { fontWeight: '700', color: colors.text },
    empty: { alignItems: 'center', marginVertical: 12, gap: 6 },
    emptyText: { color: colors.textMuted },
    resetButton: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 20, paddingVertical: 12, alignItems: 'center' },
    resetText: { color: colors.danger, fontWeight: '600' },
  });
}
