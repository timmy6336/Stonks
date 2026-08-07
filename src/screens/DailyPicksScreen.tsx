import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DailyPicksStackParamList } from '../navigation/types';
import { computeDailyPicks, getCachedDailyPicks, type DailyPick, type DailyPicksResult } from '../picks/dailyPicks';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';

type Props = NativeStackScreenProps<DailyPicksStackParamList, 'DailyPicks'>;

export function DailyPicksScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [result, setResult] = useState<DailyPicksResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const cached = await getCachedDailyPicks();
    if (cached) {
      setResult(cached);
      setLoading(false);
    } else {
      setLoading(false);
      await handleCompute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleCompute = async () => {
    setComputing(true);
    try {
      const fresh = await computeDailyPicks();
      setResult(fresh);
    } finally {
      setComputing(false);
    }
  };

  const goToDetail = (symbol: string) => navigation.navigate('StockDetail', { symbol });

  const renderPick = (pick: DailyPick) => (
    <Pressable key={pick.symbol} style={styles.pickCard} onPress={() => goToDetail(pick.symbol)}>
      <View style={styles.rankBadge}>
        <Text style={styles.rankBadgeText}>#{pick.rank}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.pickHeaderRow}>
          <Text style={styles.pickSymbol}>{pick.symbol}</Text>
          <Text style={[styles.pickChange, { color: pick.changePercent >= 0 ? colors.accent : colors.danger }]}>
            ${pick.price.toFixed(2)} ({pick.changePercent >= 0 ? '+' : ''}
            {pick.changePercent.toFixed(2)}%)
          </Text>
        </View>
        <Text style={styles.pickReasoning}>{pick.reasoning}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );

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
      refreshControl={<RefreshControl refreshing={computing} onRefresh={handleCompute} />}
    >
      <Text style={styles.introHint}>
        Two independent takes on what's worth a closer look today — a transparent rule-based score, and a separate
        AI-generated shortlist. Neither is a recommendation to buy; both are starting points for your own research.
        Recomputed once per day (pull to refresh for an update).
      </Text>

      <View style={styles.sectionHeader}>
        <Ionicons name="calculator" size={18} color={colors.accent} />
        <Text style={styles.sectionTitle}>Top 5 — Math model</Text>
      </View>
      <Text style={styles.sectionHint}>
        Combines the rule-based technical signal, 30-day trend projection, recent momentum, and how many independent
        source lists (gainers, trending, curated screeners, etc.) each symbol showed up on.
      </Text>
      {result?.mathError && <Text style={styles.error}>{result.mathError}</Text>}
      {computing && (!result || result.math.length === 0) ? (
        <ActivityIndicator style={{ marginVertical: 16 }} />
      ) : (
        result?.math.map(renderPick)
      )}

      <View style={styles.sectionHeader}>
        <Ionicons name="sparkles" size={18} color={colors.accent} />
        <Text style={styles.sectionTitle}>Top 5 — AI model</Text>
      </View>
      <Text style={styles.sectionHint}>
        Your active AI provider, given the same broad candidate data (plus recent headlines for the strongest
        contenders) and asked to pick its own top 5 — independently of the math model above.
      </Text>
      {result?.aiError && (
        <View style={styles.aiErrorBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Text style={styles.aiErrorText}>{result.aiError}</Text>
        </View>
      )}
      {computing && (!result || (result.ai === null && !result.aiError)) ? (
        <ActivityIndicator style={{ marginVertical: 16 }} />
      ) : (
        result?.ai?.map(renderPick)
      )}

      {result?.aiRawResponse && (
        <>
          <View style={styles.sectionHeader}>
            <Ionicons name="document-text-outline" size={16} color={colors.accent} />
            <Text style={styles.sectionTitle}>Raw AI response</Text>
          </View>
          <Text style={styles.sectionHint}>
            Exactly what the AI provider returned — useful for seeing why a pick was made, or why parsing failed.
          </Text>
          <View style={styles.rawBox}>
            <Text style={styles.rawText} selectable>
              {result.aiRawResponse}
            </Text>
          </View>
        </>
      )}

      {result && (
        <Text style={styles.computedAtText}>
          Last computed {new Date(result.computedAt).toLocaleString()} for {result.date}.
        </Text>
      )}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
    introHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 16 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 4 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    sectionHint: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginBottom: 10 },
    error: { color: colors.danger, marginBottom: 8 },
    aiErrorBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      backgroundColor: colors.chipBackground,
      borderRadius: 8,
      padding: 10,
      marginBottom: 10,
    },
    aiErrorText: { color: colors.textMuted, fontSize: 12, flex: 1, lineHeight: 17 },
    rawBox: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 12 },
    rawText: { color: colors.textSecondary, fontFamily: 'monospace', fontSize: 12, lineHeight: 17 },
    pickCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 12,
      marginBottom: 10,
    },
    rankBadge: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.chipBackground,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rankBadgeText: { color: colors.text, fontWeight: '700', fontSize: 12, includeFontPadding: false },
    pickHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    pickSymbol: { color: colors.text, fontWeight: '700', fontSize: 15 },
    pickChange: { fontSize: 13, fontWeight: '600', includeFontPadding: false },
    pickReasoning: { color: colors.textSecondary, fontSize: 12, marginTop: 3, lineHeight: 16 },
    computedAtText: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12, marginBottom: 8 },
  });
}
