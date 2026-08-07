import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DailyPicksStackParamList } from '../navigation/types';
import { computeDailyPicks, getCachedDailyPicks, type DailyPick, type DailyPicksResult } from '../picks/dailyPicks';
import { getAppStateValue, setAppStateValue } from '../db/database';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';

type Props = NativeStackScreenProps<DailyPicksStackParamList, 'DailyPicks'>;

const MAX_PRICE_KEY = 'daily_picks_max_price';

function parsePrice(input: string): number | null {
  const n = Number(input.trim());
  return input.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

export function DailyPicksScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [result, setResult] = useState<DailyPicksResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [maxPriceInput, setMaxPriceInput] = useState('');

  const handleCompute = useCallback(async (maxPriceOverride?: number | null) => {
    setComputing(true);
    try {
      const effectiveMaxPrice = maxPriceOverride === undefined ? parsePrice(maxPriceInput) : maxPriceOverride;
      const fresh = await computeDailyPicks(effectiveMaxPrice);
      setResult(fresh);
    } finally {
      setComputing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxPriceInput]);

  const load = useCallback(async () => {
    setLoading(true);
    const savedMaxPrice = await getAppStateValue(MAX_PRICE_KEY);
    if (savedMaxPrice) setMaxPriceInput(savedMaxPrice);
    const parsedMaxPrice = savedMaxPrice ? parsePrice(savedMaxPrice) : null;

    const cached = await getCachedDailyPicks();
    if (cached && cached.maxPriceFilter === parsedMaxPrice) {
      setResult(cached);
      setLoading(false);
    } else {
      setLoading(false);
      await handleCompute(parsedMaxPrice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleRecalculate = async () => {
    await setAppStateValue(MAX_PRICE_KEY, maxPriceInput.trim());
    await handleCompute();
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
      refreshControl={<RefreshControl refreshing={computing} onRefresh={() => handleCompute()} />}
    >
      <Text style={styles.introHint}>
        Two independent takes on what's worth a closer look today — a transparent rule-based score, and a separate
        AI-generated shortlist. Neither is a recommendation to buy; both are starting points for your own research.
        Recomputed once per day, or whenever you recalculate below.
      </Text>

      <View style={styles.filterRow}>
        <View style={styles.filterInputWrap}>
          <Text style={styles.filterLabel}>Max price ($)</Text>
          <TextInput
            style={styles.filterInput}
            placeholder="No limit"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            value={maxPriceInput}
            onChangeText={setMaxPriceInput}
          />
        </View>
        <Pressable style={styles.recalculateButton} onPress={handleRecalculate} disabled={computing}>
          {computing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.recalculateButtonText}>Recalculate</Text>
            </>
          )}
        </Pressable>
      </View>
      {result?.maxPriceFilter != null && (
        <Text style={styles.filterAppliedHint}>
          Both lists below are limited to symbols trading at ${result.maxPriceFilter.toFixed(2)} or less — fewer than
          5 may show if not enough candidates qualify.
        </Text>
      )}

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
    introHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 14 },
    filterRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 6 },
    filterInputWrap: { flex: 1 },
    filterLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 4 },
    filterInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: colors.inputBackground,
      color: colors.text,
    },
    recalculateButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    recalculateButtonText: { color: '#fff', fontWeight: '700', fontSize: 13, includeFontPadding: false },
    filterAppliedHint: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginBottom: 14 },
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
