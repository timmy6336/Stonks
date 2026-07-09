import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LineChart } from 'react-native-chart-kit';
import type { StockDetailParams } from '../navigation/types';
import { fetchCompanyProfile, fetchHistory, fetchNews, fetchQuote, type NewsItem } from '../api/marketData';
import { computeSignal } from '../signals/signalEngine';
import { computeTrendPrediction, describeTrendPrediction, type TrendPrediction } from '../predictions/trendPrediction';
import { runSignalBacktest, type BacktestResult } from '../backtest/backtestEngine';
import { generateInsight, hasGeminiApiKey } from '../llm/llmClient';
import { checkAlertsForSymbol, requestNotificationPermission } from '../notifications/alertEngine';
import { executeTrade, getActiveTradingMode } from '../trading/tradingService';
import { createAlert, getPosition, logSignalIfNew } from '../db/database';
import { useTheme } from '../theme/ThemeContext';
import { hexToRgba, type ThemeColors } from '../theme/theme';
import { hapticSuccess } from '../haptics/haptics';
import type { AlertType, Candle, CompanyProfile, Position, Quote, Signal, TradingMode } from '../types';
import { SignalBadge } from '../components/SignalBadge';
import type { TradeSide } from '../types';

type Props = {
  route: { params: StockDetailParams };
};

type ChartRangeKey = '1D' | '1W' | '1M' | '6M' | '1Y' | '5Y';

const CHART_RANGES: { key: ChartRangeKey; range: string; interval: string }[] = [
  { key: '1D', range: '1d', interval: '5m' },
  { key: '1W', range: '5d', interval: '30m' },
  { key: '1M', range: '1mo', interval: '1d' },
  { key: '6M', range: '6mo', interval: '1d' },
  { key: '1Y', range: '1y', interval: '1d' },
  { key: '5Y', range: '5y', interval: '1wk' },
];

function CardTitle({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <Ionicons name={icon} size={16} color={colors.accent} />
      <Text style={{ fontWeight: '700', color: colors.text }}>{children}</Text>
    </View>
  );
}

export function StockDetailScreen({ route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { symbol } = route.params;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [chartRangeKey, setChartRangeKey] = useState<ChartRangeKey>('6M');
  const [chartCandles, setChartCandles] = useState<Candle[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [prediction, setPrediction] = useState<TrendPrediction | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [mode, setMode] = useState<TradingMode>('PAPER');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tradeSide, setTradeSide] = useState<TradeSide | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [hasAiKey, setHasAiKey] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertType, setAlertType] = useState<AlertType>('PRICE_ABOVE');
  const [alertThreshold, setAlertThreshold] = useState('');
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alertSaved, setAlertSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAiInsight(null);
    setAiError(null);
    try {
      const [q, history, pos, activeMode] = await Promise.all([
        fetchQuote(symbol),
        fetchHistory(symbol, '6mo', '1d'),
        getPosition(symbol),
        getActiveTradingMode(),
      ]);
      const sig = computeSignal(symbol, history);
      logSignalIfNew(symbol, sig.score, sig.points, q.price).catch(() => {}); // best-effort track record logging
      setQuote(q);
      setCandles(history);
      setSignal(sig);
      setPrediction(computeTrendPrediction(history));
      setBacktest(runSignalBacktest(symbol, history));
      setPosition(pos);
      setMode(activeMode);
      checkAlertsForSymbol(symbol, q, sig).catch(() => {}); // alerts are best-effort; never block the screen on them
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }

    try {
      setProfile(await fetchCompanyProfile(symbol));
    } catch {
      setProfile(null); // company profile is a nice-to-have; don't block the rest of the screen on it
    }

    try {
      setNews(await fetchNews(symbol));
    } catch {
      setNews([]); // news is a nice-to-have; don't block the rest of the screen on it
    }

    setHasAiKey(await hasGeminiApiKey());
  }, [symbol]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Chart range is independent of the fixed 6-month window used for the signal/prediction/backtest.
  useEffect(() => {
    let cancelled = false;
    const { range, interval } = CHART_RANGES.find((r) => r.key === chartRangeKey)!;
    setChartLoading(true);
    fetchHistory(symbol, range, interval)
      .then((data) => {
        if (!cancelled) setChartCandles(data);
      })
      .catch(() => {
        if (!cancelled) setChartCandles([]);
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, chartRangeKey]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleAskAi = async () => {
    if (!signal || !quote) return;
    setAiLoading(true);
    setAiError(null);
    setAiInsight(null);
    try {
      const prompt =
        `You're a calm, balanced stock analysis assistant. Give a short (3-5 sentence) plain-English take on ${symbol}` +
        `${profile ? ` (sector: ${profile.sector ?? 'unknown'}, industry: ${profile.industry ?? 'unknown'})` : ''} ` +
        `for a casual investor. Don't tell them to buy or sell — summarize the situation and note key considerations/risks.\n\n` +
        `Current price: $${quote.price.toFixed(2)} (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}% today).\n` +
        `Our rule-based technical signal says ${signal.score.replace('_', ' ')} because: ${signal.reasons.join('; ')}.\n` +
        (prediction ? `Naive linear trend projection: ${describeTrendPrediction(prediction, signal)}\n` : '') +
        (profile?.summary ? `Company summary: ${profile.summary.slice(0, 400)}` : '');
      setAiInsight(await generateInsight(prompt));
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const openAlertModal = () => {
    setAlertType('PRICE_ABOVE');
    setAlertThreshold(quote ? quote.price.toFixed(2) : '');
    setAlertError(null);
    setAlertSaved(false);
    setShowAlertModal(true);
  };

  const handleCreateAlert = async () => {
    const needsThreshold = alertType === 'PRICE_ABOVE' || alertType === 'PRICE_BELOW';
    const threshold = needsThreshold ? Number(alertThreshold) : null;
    if (needsThreshold && (!Number.isFinite(threshold) || (threshold as number) <= 0)) {
      setAlertError('Enter a valid price.');
      return;
    }
    setAlertError(null);
    try {
      await requestNotificationPermission();
      await createAlert(symbol, alertType, threshold);
      hapticSuccess();
      setAlertSaved(true);
    } catch (e) {
      setAlertError((e as Error).message);
    }
  };

  const openTrade = (side: TradeSide) => {
    setTradeSide(side);
    setQuantity('1');
    setTradeError(null);
  };

  const submitTrade = async () => {
    if (!tradeSide || !quote) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setTradeError('Enter a valid quantity.');
      return;
    }
    setSubmitting(true);
    setTradeError(null);
    try {
      await executeTrade(symbol, tradeSide, qty, quote.price);
      hapticSuccess();
      setTradeSide(null);
      await load();
    } catch (e) {
      setTradeError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !quote) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? 'Unable to load data.'}</Text>
      </View>
    );
  }

  const chartWidth = Dimensions.get('window').width - 32;
  const chartData = chartCandles.filter((_, i) => i % Math.ceil(chartCandles.length / 60 || 1) === 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.symbol}>{symbol}</Text>
          <Text style={styles.price}>${quote.price.toFixed(2)}</Text>
          <Text style={{ color: quote.change >= 0 ? colors.accent : colors.danger }}>
            {quote.change >= 0 ? '+' : ''}
            {quote.change.toFixed(2)} ({quote.changePercent.toFixed(2)}%)
          </Text>
        </View>
        {signal && <SignalBadge score={signal.score} />}
      </View>

      <View style={styles.rangeRow}>
        {CHART_RANGES.map((r) => (
          <Pressable
            key={r.key}
            style={[styles.rangeChip, chartRangeKey === r.key && styles.rangeChipSelected]}
            onPress={() => setChartRangeKey(r.key)}
          >
            <Text style={[styles.rangeChipText, chartRangeKey === r.key && styles.rangeChipTextSelected]}>{r.key}</Text>
          </Pressable>
        ))}
      </View>

      {chartLoading && chartData.length === 0 ? (
        <ActivityIndicator style={{ marginVertical: 24 }} />
      ) : chartData.length > 1 ? (
        <LineChart
          data={{ labels: [], datasets: [{ data: chartData.map((c) => c.close) }] }}
          width={chartWidth}
          height={200}
          withDots={false}
          withInnerLines={false}
          withHorizontalLabels
          withVerticalLabels={false}
          chartConfig={{
            backgroundGradientFrom: colors.card,
            backgroundGradientTo: colors.card,
            color: (opacity = 1) => hexToRgba(colors.accent, opacity),
            labelColor: () => colors.text,
            decimalPlaces: 2,
          }}
          bezier
          style={{ marginVertical: 8, borderRadius: 12 }}
        />
      ) : (
        <Text style={[styles.reason, { marginVertical: 12 }]}>No chart data available for this range.</Text>
      )}

      {profile && (profile.fiftyTwoWeekHigh || profile.volume || profile.dividendYield || profile.nextEarningsDate) && (
        <View style={styles.card}>
          <CardTitle icon="stats-chart">Key stats</CardTitle>
          <View style={styles.statsGrid}>
            {profile.fiftyTwoWeekLow != null && profile.fiftyTwoWeekHigh != null && (
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>52-week range</Text>
                <Text style={styles.statValue}>
                  ${profile.fiftyTwoWeekLow.toFixed(2)} - ${profile.fiftyTwoWeekHigh.toFixed(2)}
                </Text>
              </View>
            )}
            {profile.volume != null && (
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Volume</Text>
                <Text style={styles.statValue}>{profile.volume.toLocaleString()}</Text>
              </View>
            )}
            {profile.averageVolume != null && (
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Avg. volume</Text>
                <Text style={styles.statValue}>{profile.averageVolume.toLocaleString()}</Text>
              </View>
            )}
            {profile.dividendYield != null && (
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Dividend yield</Text>
                <Text style={styles.statValue}>{(profile.dividendYield * 100).toFixed(2)}%</Text>
              </View>
            )}
            {profile.nextEarningsDate != null && (
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Next earnings</Text>
                <Text style={styles.statValue}>{new Date(profile.nextEarningsDate).toLocaleDateString()}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {signal && (
        <View style={styles.card}>
          <CardTitle icon="bulb">Why this signal</CardTitle>
          {signal.reasons.map((reason, i) => (
            <Text key={i} style={styles.reason}>
              • {reason}
            </Text>
          ))}
        </View>
      )}

      {signal && (
        <View style={styles.card}>
          <CardTitle icon="analytics">Trend projection</CardTitle>
          <Text style={styles.reason}>{describeTrendPrediction(prediction, signal)}</Text>
        </View>
      )}

      {backtest && (
        <View style={styles.card}>
          <CardTitle icon="flask">Backtest: does the signal actually help?</CardTitle>
          <Text style={styles.reason}>
            Following this signal from {backtest.startDate} to {backtest.endDate} would have returned{' '}
            <Text style={{ fontWeight: '700', color: backtest.strategyReturnPercent >= 0 ? colors.accent : colors.danger }}>
              {backtest.strategyReturnPercent >= 0 ? '+' : ''}
              {backtest.strategyReturnPercent.toFixed(1)}%
            </Text>
            , versus simply buying and holding at{' '}
            <Text style={{ fontWeight: '700', color: backtest.buyHoldReturnPercent >= 0 ? colors.accent : colors.danger }}>
              {backtest.buyHoldReturnPercent >= 0 ? '+' : ''}
              {backtest.buyHoldReturnPercent.toFixed(1)}%
            </Text>
            {' '}over the same period ({backtest.trades} trades{backtest.winRate !== null ? `, ${backtest.winRate.toFixed(0)}% of round-trips profitable` : ''}
            ).
          </Text>
          <Text style={styles.disclaimer}>
            Past performance on one stock over one window proves very little — treat this as a sanity check, not
            evidence the signal works in general.
          </Text>
        </View>
      )}

      {profile && (
        <View style={styles.card}>
          <CardTitle icon="business">About the company</CardTitle>
          {(profile.sector || profile.industry) && (
            <Text style={styles.profileMeta}>
              {[profile.sector, profile.industry].filter(Boolean).join(' · ')}
              {profile.employees ? ` · ${profile.employees.toLocaleString()} employees` : ''}
            </Text>
          )}
          {profile.summary && <Text style={styles.reason}>{profile.summary}</Text>}
          {profile.website && (
            <Pressable style={styles.linkRow} onPress={() => Linking.openURL(profile.website!)}>
              <Ionicons name="globe-outline" size={14} color={colors.accent} />
              <Text style={styles.link}>{profile.website}</Text>
            </Pressable>
          )}
        </View>
      )}

      {news.length > 0 && (
        <View style={styles.card}>
          <CardTitle icon="newspaper">Latest news</CardTitle>
          {news.slice(0, 6).map((n) => (
            <Pressable key={n.id} style={styles.newsRow} onPress={() => Linking.openURL(n.link)}>
              <Text style={styles.newsTitle} numberOfLines={2}>
                {n.title}
              </Text>
              <Text style={styles.newsMeta}>
                {n.publisher} · {new Date(n.publishedAt).toLocaleDateString()}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <CardTitle icon="sparkles">AI insight</CardTitle>
        {!hasAiKey ? (
          <Text style={styles.reason}>Add a free Gemini API key in Settings to get an AI-generated take on this stock.</Text>
        ) : (
          <>
            <Pressable style={styles.aiButton} onPress={handleAskAi} disabled={aiLoading}>
              {aiLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={16} color="#fff" />
                  <Text style={styles.actionText}>Generate AI insight</Text>
                </>
              )}
            </Pressable>
            {aiError && <Text style={[styles.error, { marginTop: 8 }]}>{aiError}</Text>}
            {aiInsight && <Text style={[styles.reason, { marginTop: 10 }]}>{aiInsight}</Text>}
          </>
        )}
      </View>

      {position && (
        <View style={styles.card}>
          <CardTitle icon="briefcase">Your position</CardTitle>
          <Text style={{ color: colors.text }}>
            {position.quantity} shares @ avg ${position.avgCost.toFixed(2)}
          </Text>
          <Text style={{ color: quote.price >= position.avgCost ? colors.accent : colors.danger }}>
            Unrealized P&L: ${((quote.price - position.avgCost) * position.quantity).toFixed(2)}
          </Text>
        </View>
      )}

      <View style={styles.modeRow}>
        <Ionicons name={mode === 'LIVE' ? 'flash' : 'flask-outline'} size={14} color={colors.textSecondary} />
        <Text style={styles.modeLabel}>Mode: {mode === 'LIVE' ? 'LIVE (real money)' : 'Paper (simulated)'}</Text>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={[styles.actionButton, styles.buy]} onPress={() => openTrade('BUY')}>
          <Ionicons name="arrow-up-circle" size={18} color="#fff" />
          <Text style={styles.actionText}>Buy</Text>
        </Pressable>
        <Pressable style={[styles.actionButton, styles.sell]} onPress={() => openTrade('SELL')}>
          <Ionicons name="arrow-down-circle" size={18} color="#fff" />
          <Text style={styles.actionText}>Sell</Text>
        </Pressable>
      </View>

      <Pressable style={styles.alertButton} onPress={openAlertModal}>
        <Ionicons name="notifications-outline" size={16} color={colors.accent} />
        <Text style={styles.alertButtonText}>Set alert</Text>
      </Pressable>

      <Modal visible={showAlertModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Set an alert for {symbol}</Text>
            {(
              [
                ['PRICE_ABOVE', 'Price rises above'],
                ['PRICE_BELOW', 'Price drops below'],
                ['SIGNAL_BUY_OR_BETTER', 'Signal reaches BUY'],
                ['SIGNAL_STRONG_BUY', 'Signal reaches STRONG BUY'],
              ] as [AlertType, string][]
            ).map(([type, label]) => (
              <Pressable key={type} style={styles.alertTypeRow} onPress={() => setAlertType(type)}>
                <Ionicons
                  name={alertType === type ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={alertType === type ? colors.accent : colors.textMuted}
                />
                <Text style={styles.alertTypeLabel}>{label}</Text>
              </Pressable>
            ))}
            {(alertType === 'PRICE_ABOVE' || alertType === 'PRICE_BELOW') && (
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={alertThreshold}
                onChangeText={setAlertThreshold}
                placeholder="Price"
                placeholderTextColor={colors.textMuted}
              />
            )}
            {alertError && <Text style={styles.error}>{alertError}</Text>}
            {alertSaved ? (
              <Text style={[styles.reason, { color: colors.accent }]}>
                Alert saved. You can manage it from the bell icon on Watchlist.
              </Text>
            ) : null}
            <View style={styles.actionRow}>
              <Pressable style={styles.actionButton} onPress={() => setShowAlertModal(false)}>
                <Ionicons name="close-circle-outline" size={18} color={colors.text} />
                <Text style={{ color: colors.text }}>{alertSaved ? 'Close' : 'Cancel'}</Text>
              </Pressable>
              {!alertSaved && (
                <Pressable style={[styles.actionButton, styles.buy]} onPress={handleCreateAlert}>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.actionText}>Save alert</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={tradeSide !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>
              {tradeSide} {symbol} {mode === 'LIVE' ? '(real order)' : '(simulated)'}
            </Text>
            <Text style={{ marginBottom: 4, color: colors.text }}>Price: ${quote.price.toFixed(2)}</Text>
            <Text style={{ marginBottom: 8, color: colors.textSecondary }}>
              You currently own {position ? position.quantity : 0} share{position?.quantity === 1 ? '' : 's'}
            </Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={quantity}
              onChangeText={setQuantity}
              placeholder="Quantity"
              placeholderTextColor={colors.textMuted}
            />
            {tradeError && <Text style={styles.error}>{tradeError}</Text>}
            <View style={styles.actionRow}>
              <Pressable style={styles.actionButton} onPress={() => setTradeSide(null)}>
                <Ionicons name="close-circle-outline" size={18} color={colors.text} />
                <Text style={{ color: colors.text }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, tradeSide === 'BUY' ? styles.buy : styles.sell]}
                onPress={submitTrade}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={styles.actionText}>Confirm</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    symbol: { fontSize: 22, fontWeight: '700', color: colors.text },
    price: { fontSize: 28, fontWeight: '600', marginTop: 4, color: colors.text },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginTop: 16 },
    rangeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
    rangeChip: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.chipBackground,
    },
    rangeChipSelected: { backgroundColor: colors.accent },
    rangeChipText: { color: colors.text, fontWeight: '600', fontSize: 12, includeFontPadding: false },
    rangeChipTextSelected: { color: '#fff' },
    statsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    statItem: { width: '50%', marginBottom: 10 },
    statLabel: { color: colors.textMuted, fontSize: 11 },
    statValue: { color: colors.text, fontWeight: '700', fontSize: 15, marginTop: 2 },
    cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    cardTitle: { fontWeight: '700', color: colors.text },
    reason: { marginBottom: 4, color: colors.text, lineHeight: 20 },
    profileMeta: { color: colors.textSecondary, marginBottom: 8, fontWeight: '600' },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
    link: { color: colors.accent },
    disclaimer: { color: colors.textMuted, fontSize: 11, marginTop: 8, fontStyle: 'italic' },
    newsRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    newsTitle: { color: colors.accent, fontWeight: '600', marginBottom: 2 },
    newsMeta: { color: colors.textMuted, fontSize: 11 },
    aiButton: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
    },
    modeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
    modeLabel: { color: colors.textSecondary, fontStyle: 'italic' },
    actionRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: colors.chipBackground,
    },
    buy: { backgroundColor: colors.accent },
    sell: { backgroundColor: colors.danger },
    actionText: { color: '#fff', fontWeight: '700', includeFontPadding: false },
    alertButton: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      alignItems: 'center',
      marginTop: 12,
      paddingVertical: 10,
    },
    alertButtonText: { color: colors.accent, fontWeight: '600' },
    alertTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
    alertTypeLabel: { color: colors.text },
    error: { color: colors.danger, marginBottom: 8 },
    modalBackdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'center', padding: 24 },
    modalCard: { backgroundColor: colors.card, borderRadius: 12, padding: 20 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 10,
      marginBottom: 8,
      color: colors.text,
      backgroundColor: colors.inputBackground,
    },
  });
}
