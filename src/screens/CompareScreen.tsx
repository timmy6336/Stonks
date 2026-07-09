import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-chart-kit';
import { fetchHistory, searchSymbols, type SymbolSearchResult } from '../api/marketData';
import { useTheme } from '../theme/ThemeContext';
import { hexToRgba, type ThemeColors } from '../theme/theme';
import type { Candle } from '../types';

const RANGE_OPTIONS: { key: string; range: string; interval: string }[] = [
  { key: '1M', range: '1mo', interval: '1d' },
  { key: '6M', range: '6mo', interval: '1d' },
  { key: '1Y', range: '1y', interval: '1d' },
];

const LINE_COLORS = ['#0a7d32', '#2b6cb0', '#c0392b', '#8e44ad', '#d9822b', '#16a085'];
const MAX_SYMBOLS = 6;

type SeriesEntry = {
  symbol: string;
  candles: Candle[];
  color: string;
  error?: string;
};

export function CompareScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [series, setSeries] = useState<SeriesEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [rangeKey, setRangeKey] = useState('6M');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        setSearchResults(await searchSymbols(q));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (symbols.length === 0) {
      setSeries([]);
      return;
    }
    let cancelled = false;
    const opt = RANGE_OPTIONS.find((o) => o.key === rangeKey)!;
    setLoading(true);
    Promise.all(
      symbols.map(async (symbol, i) => {
        try {
          const candles = await fetchHistory(symbol, opt.range, opt.interval);
          return { symbol, candles, color: LINE_COLORS[i % LINE_COLORS.length] };
        } catch (e) {
          return { symbol, candles: [], color: LINE_COLORS[i % LINE_COLORS.length], error: (e as Error).message };
        }
      })
    ).then((results) => {
      if (!cancelled) setSeries(results);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [symbols, rangeKey]);

  const addSymbol = (symbol: string) => {
    const upper = symbol.toUpperCase();
    if (symbols.includes(upper) || symbols.length >= MAX_SYMBOLS) return;
    setSymbols([...symbols, upper]);
    setQuery('');
    setSearchResults([]);
  };

  const removeSymbol = (symbol: string) => setSymbols(symbols.filter((s) => s !== symbol));

  const validSeries = series.filter((s) => s.candles.length > 1);
  const minLen = validSeries.length ? Math.min(...validSeries.map((s) => s.candles.length)) : 0;
  const step = Math.max(1, Math.floor(minLen / 60));
  const chartWidth = Dimensions.get('window').width - 32;

  const datasets = validSeries.map((s) => {
    const base = s.candles[0].close;
    const trimmed = s.candles.slice(0, minLen).filter((_, i) => i % step === 0);
    return {
      data: trimmed.map((c) => (base !== 0 ? ((c.close - base) / base) * 100 : 0)),
      color: (opacity = 1) => hexToRgba(s.color, opacity),
      strokeWidth: 2,
    };
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.helpText}>
        Add two or more stocks to overlay their normalized % change over the same period — useful for seeing which
        outperformed regardless of price level.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Search company or ticker to add"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        value={query}
        onChangeText={setQuery}
      />
      {searching && <ActivityIndicator size="small" style={{ marginBottom: 8 }} />}
      {searchResults.length > 0 && (
        <View style={styles.searchResults}>
          {searchResults.map((r) => (
            <Pressable key={r.symbol} style={styles.searchRow} onPress={() => addSymbol(r.symbol)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.searchSymbol}>{r.symbol}</Text>
                <Text style={styles.searchName} numberOfLines={1}>
                  {r.name}
                </Text>
              </View>
              <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
            </Pressable>
          ))}
        </View>
      )}

      {symbols.length > 0 && (
        <View style={styles.chipRow}>
          {symbols.map((s, i) => (
            <View key={s} style={[styles.chip, { borderColor: LINE_COLORS[i % LINE_COLORS.length] }]}>
              <View style={[styles.dot, { backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }]} />
              <Text style={styles.chipText}>{s}</Text>
              <Pressable onPress={() => removeSymbol(s)} hitSlop={8}>
                <Ionicons name="close" size={14} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={styles.rangeRow}>
        {RANGE_OPTIONS.map((r) => (
          <Pressable
            key={r.key}
            style={[styles.rangeChip, rangeKey === r.key && styles.rangeChipSelected]}
            onPress={() => setRangeKey(r.key)}
          >
            <Text style={[styles.rangeChipText, rangeKey === r.key && styles.rangeChipTextSelected]}>{r.key}</Text>
          </Pressable>
        ))}
      </View>

      {symbols.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="git-compare-outline" size={28} color={colors.textMuted} />
          <Text style={styles.emptyText}>Search above and add a couple of stocks to compare.</Text>
        </View>
      ) : loading ? (
        <ActivityIndicator style={{ marginVertical: 24 }} />
      ) : datasets.length > 1 && datasets[0].data.length > 1 ? (
        <LineChart
          data={{ labels: [], datasets }}
          width={chartWidth}
          height={220}
          withDots={false}
          withInnerLines={false}
          withHorizontalLabels
          withVerticalLabels={false}
          chartConfig={{
            backgroundGradientFrom: colors.card,
            backgroundGradientTo: colors.card,
            color: (opacity = 1) => hexToRgba(colors.text, opacity),
            labelColor: () => colors.text,
            decimalPlaces: 1,
          }}
          bezier
          style={{ marginVertical: 8, borderRadius: 12 }}
        />
      ) : (
        <Text style={[styles.helpText, { marginTop: 12 }]}>Add at least one more stock with chart data to compare.</Text>
      )}

      {series.map((s, i) => {
        const latest = s.candles.length > 1 ? ((s.candles[s.candles.length - 1].close - s.candles[0].close) / s.candles[0].close) * 100 : null;
        return (
          <View key={s.symbol} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }]} />
            <Text style={styles.legendSymbol}>{s.symbol}</Text>
            {s.error ? (
              <Text style={styles.error}>{s.error}</Text>
            ) : latest !== null ? (
              <Text style={[styles.legendValue, { color: latest >= 0 ? colors.accent : colors.danger }]}>
                {latest >= 0 ? '+' : ''}
                {latest.toFixed(1)}%
              </Text>
            ) : (
              <ActivityIndicator size="small" />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    helpText: { color: colors.textSecondary, marginBottom: 12, lineHeight: 18 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 10,
      color: colors.text,
      backgroundColor: colors.inputBackground,
      marginBottom: 8,
    },
    searchResults: { backgroundColor: colors.card, borderRadius: 8, marginBottom: 12, overflow: 'hidden' },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 8,
    },
    searchSymbol: { fontWeight: '700', color: colors.text },
    searchName: { color: colors.textSecondary, fontSize: 12 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      borderWidth: 1,
      backgroundColor: colors.chipBackground,
    },
    chipText: { color: colors.text, fontWeight: '600', fontSize: 13, includeFontPadding: false },
    dot: { width: 8, height: 8, borderRadius: 4 },
    rangeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    rangeChip: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8, backgroundColor: colors.chipBackground },
    rangeChipSelected: { backgroundColor: colors.accent },
    rangeChipText: { color: colors.text, fontWeight: '600', fontSize: 12, includeFontPadding: false },
    rangeChipTextSelected: { color: '#fff' },
    empty: { alignItems: 'center', marginTop: 40, gap: 8 },
    emptyText: { color: colors.textMuted, textAlign: 'center' },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
    legendSymbol: { color: colors.text, fontWeight: '700', flex: 1 },
    legendValue: { fontWeight: '700' },
    error: { color: colors.danger, fontSize: 12 },
  });
}
