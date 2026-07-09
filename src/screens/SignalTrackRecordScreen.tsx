import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getSignalLog } from '../db/database';
import { fetchQuote } from '../api/marketData';
import { evaluateSignalLog, summarizeSignalTrackRecord, type EvaluatedSignalEntry, type SignalScoreStats } from '../signals/trackRecord';
import { SignalBadge } from '../components/SignalBadge';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';

export function SignalTrackRecordScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [stats, setStats] = useState<SignalScoreStats[]>([]);
  const [recent, setRecent] = useState<EvaluatedSignalEntry[]>([]);
  const [totalLogged, setTotalLogged] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const entries = await getSignalLog();
    setTotalLogged(entries.length);
    const symbols = [...new Set(entries.map((e) => e.symbol))];
    const quotes = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          return [symbol, (await fetchQuote(symbol)).price] as const;
        } catch {
          return null;
        }
      })
    );
    const priceMap = new Map(quotes.filter((q): q is readonly [string, number] => q !== null));
    const evaluated = evaluateSignalLog(entries, priceMap);
    setStats(summarizeSignalTrackRecord(evaluated));
    setRecent(evaluated.slice(0, 25));
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <Text style={styles.helpText}>
        Every time the app computes a BUY/SELL/HOLD signal for a stock on your watchlist or that you've viewed, it's
        logged (once per stock per day). At least a day later, we check whether the price actually moved the way the
        call implied. This is a small, self-reported sample — treat it as a rough sanity check, not a rigorous
        backtest.
      </Text>

      {totalLogged === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="time-outline" size={28} color={colors.textMuted} />
          <Text style={styles.emptyText}>
            No signals logged yet. Visit your watchlist or a stock's detail page to start building a track record.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Accuracy by call</Text>
            {stats.length === 0 ? (
              <Text style={styles.reason}>Nothing is old enough to judge yet — check back after a day or two.</Text>
            ) : (
              stats.map((s) => (
                <View key={s.score} style={styles.statRow}>
                  <SignalBadge score={s.score} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.statMain}>
                      {s.callable > 0
                        ? `${s.correct}/${s.callable} correct (${((s.correct / s.callable) * 100).toFixed(0)}%)`
                        : 'No directional call'}
                    </Text>
                    <Text style={styles.statSub}>
                      {s.count} logged · avg move {s.avgReturnPercent >= 0 ? '+' : ''}
                      {s.avgReturnPercent.toFixed(1)}%
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recent evaluated calls</Text>
            {recent.length === 0 ? (
              <Text style={styles.reason}>Nothing old enough to evaluate yet.</Text>
            ) : (
              recent.map((e) => (
                <View key={e.id} style={styles.entryRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.entrySymbol}>{e.symbol}</Text>
                    <Text style={styles.entryDate}>{new Date(e.loggedAt).toLocaleDateString()}</Text>
                  </View>
                  <SignalBadge score={e.score} />
                  <Text style={[styles.entryReturn, { color: e.returnPercent >= 0 ? colors.accent : colors.danger }]}>
                    {e.returnPercent >= 0 ? '+' : ''}
                    {e.returnPercent.toFixed(1)}%
                  </Text>
                  {e.correct !== null && (
                    <Ionicons
                      name={e.correct ? 'checkmark-circle' : 'close-circle'}
                      size={18}
                      color={e.correct ? colors.accent : colors.danger}
                    />
                  )}
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    helpText: { color: colors.textSecondary, marginBottom: 16, lineHeight: 18 },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 16 },
    cardTitle: { fontWeight: '700', color: colors.text, marginBottom: 10 },
    reason: { color: colors.text, lineHeight: 20 },
    statRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    statMain: { color: colors.text, fontWeight: '600' },
    statSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    entrySymbol: { color: colors.text, fontWeight: '700' },
    entryDate: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    entryReturn: { fontWeight: '700', fontSize: 13 },
    empty: { alignItems: 'center', marginTop: 40, gap: 8 },
    emptyText: { color: colors.textMuted, textAlign: 'center' },
  });
}
