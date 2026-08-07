import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TrendingStackParamList } from '../navigation/types';
import { fetchScreener, fetchTrendingSymbols } from '../api/marketData';
import { addToWatchlist, getAppStateValue, setAppStateValue } from '../db/database';
import { useTickerRows } from '../hooks/useTickerRows';
import { TickerRow } from '../components/TickerRow';
import { STOCK_CATEGORIES } from '../data/categories';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';
import { matchesSignalFilter, SignalFilterRow, type SignalFilter } from '../components/SignalFilterRow';
import { sortRows, SortMenuButton, type SortMode } from '../components/SortMenuButton';
import { hapticSuccess } from '../haptics/haptics';
import type { TickerRowData } from '../hooks/useTickerRows';

type Props = NativeStackScreenProps<TrendingStackParamList, 'Trending'>;

const CATEGORY_KEY = 'trending_selected_category';
const FILTER_KEY = 'trending_signal_filter';
const SORT_KEY = 'trending_sort_mode';

export function TrendingScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [trendingSymbols, setTrendingSymbols] = useState<string[]>([]);
  const [trendingError, setTrendingError] = useState<string | null>(null);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [onSaleSymbols, setOnSaleSymbols] = useState<string[]>([]);
  const [onSaleError, setOnSaleError] = useState<string | null>(null);
  const [onSaleLoading, setOnSaleLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState(STOCK_CATEGORIES[0].id);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [signalFilter, setSignalFilterState] = useState<SignalFilter>('ALL');
  const [sortMode, setSortModeState] = useState<SortMode>('DEFAULT');

  // Restore last-used category/filter/sort so the screen doesn't reset every time you leave the tab.
  useEffect(() => {
    (async () => {
      const [savedCategory, savedFilter, savedSort] = await Promise.all([
        getAppStateValue(CATEGORY_KEY),
        getAppStateValue(FILTER_KEY),
        getAppStateValue(SORT_KEY),
      ]);
      if (savedCategory && STOCK_CATEGORIES.some((c) => c.id === savedCategory)) setSelectedCategoryId(savedCategory);
      if (savedFilter) setSignalFilterState(savedFilter as SignalFilter);
      if (savedSort) setSortModeState(savedSort as SortMode);
    })();
  }, []);

  const setSelectedCategory = (id: string) => {
    setSelectedCategoryId(id);
    setAppStateValue(CATEGORY_KEY, id).catch(() => {});
  };
  const setSignalFilter = (f: SignalFilter) => {
    setSignalFilterState(f);
    setAppStateValue(FILTER_KEY, f).catch(() => {});
  };
  const setSortMode = (m: SortMode) => {
    setSortModeState(m);
    setAppStateValue(SORT_KEY, m).catch(() => {});
  };

  const loadTrending = useCallback(async () => {
    setTrendingLoading(true);
    setTrendingError(null);
    try {
      setTrendingSymbols(await fetchTrendingSymbols());
    } catch (e) {
      setTrendingError((e as Error).message);
    } finally {
      setTrendingLoading(false);
    }
  }, []);

  const loadOnSale = useCallback(async () => {
    setOnSaleLoading(true);
    setOnSaleError(null);
    try {
      setOnSaleSymbols(await fetchScreener('day_losers', 100));
    } catch (e) {
      setOnSaleError((e as Error).message);
    } finally {
      setOnSaleLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrending();
    loadOnSale();
  }, [loadTrending, loadOnSale]);

  useFocusEffect(
    useCallback(() => {
      setJustAdded(null);
    }, [])
  );

  const trending = useTickerRows(trendingSymbols);
  const onSale = useTickerRows(onSaleSymbols);
  const selectedCategory = STOCK_CATEGORIES.find((c) => c.id === selectedCategoryId) ?? STOCK_CATEGORIES[0];
  const category = useTickerRows(selectedCategory.symbols);

  const handleAddToWatchlist = async (symbol: string) => {
    await addToWatchlist(symbol);
    hapticSuccess();
    setJustAdded(symbol);
  };

  const goToDetail = (symbol: string) => navigation.navigate('StockDetail', { symbol });

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadTrending(), loadOnSale(), trending.reload(), onSale.reload(), category.reload()]);
    setRefreshing(false);
  };

  const applyFilters = (rows: TickerRowData[]) =>
    sortRows(rows.filter((row) => matchesSignalFilter(row.signal?.score, signalFilter)), sortMode);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <SignalFilterRow value={signalFilter} onChange={setSignalFilter} />
      <SortMenuButton value={sortMode} onChange={setSortMode} />

      <View style={styles.sectionHeader}>
        <Ionicons name="flame" size={18} color={colors.accent} />
        <Text style={styles.sectionTitle}>Trending now</Text>
      </View>
      {trendingError && <Text style={styles.error}>{trendingError}</Text>}
      {trendingLoading && trending.rows.length === 0 ? (
        <ActivityIndicator style={{ marginVertical: 12 }} />
      ) : (
        applyFilters(trending.rows).map((row) => (
          <TickerRow key={row.symbol} row={row} onPress={goToDetail} onAddToWatchlist={handleAddToWatchlist} />
        ))
      )}

      <View style={styles.sectionHeader}>
        <Ionicons name="pricetag" size={18} color={colors.warning} />
        <Text style={styles.sectionTitle}>On sale</Text>
      </View>
      <Text style={styles.categoryHint}>
        Today's biggest drops. A STRONG BUY badge here means our signal still likes it despite the dip — not a
        guarantee it bounces back.
      </Text>
      {onSaleError && <Text style={styles.error}>{onSaleError}</Text>}
      {onSaleLoading && onSale.rows.length === 0 ? (
        <ActivityIndicator style={{ marginVertical: 12 }} />
      ) : (
        applyFilters(onSale.rows).map((row) => (
          <TickerRow
            key={row.symbol}
            row={row}
            onPress={goToDetail}
            onAddToWatchlist={handleAddToWatchlist}
            showRecoveryHighlight
          />
        ))
      )}

      <View style={styles.sectionHeader}>
        <Ionicons name="grid" size={18} color={colors.accent} />
        <Text style={styles.sectionTitle}>Browse by category</Text>
      </View>
      <Text style={styles.categoryHint}>Curated groupings for browsing, not an official sector classification.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {STOCK_CATEGORIES.map((c) => (
          <Pressable
            key={c.id}
            style={[styles.chip, c.id === selectedCategoryId && styles.chipSelected]}
            onPress={() => setSelectedCategory(c.id)}
          >
            <Ionicons name={c.icon} size={14} color={c.id === selectedCategoryId ? '#fff' : colors.text} />
            <Text style={[styles.chipText, c.id === selectedCategoryId && styles.chipTextSelected]}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {applyFilters(category.rows).map((row) => (
        <TickerRow key={row.symbol} row={row} onPress={goToDetail} onAddToWatchlist={handleAddToWatchlist} />
      ))}

      {justAdded && <Text style={styles.addedNote}>Added {justAdded} to your watchlist.</Text>}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, marginBottom: 4 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    categoryHint: { color: colors.textMuted, fontSize: 12, marginBottom: 10 },
    chipRow: { marginBottom: 4 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: colors.chipBackground,
      marginRight: 8,
    },
    chipSelected: { backgroundColor: colors.accent },
    chipText: { color: colors.text, fontWeight: '600', fontSize: 13, includeFontPadding: false },
    chipTextSelected: { color: '#fff' },
    error: { color: colors.danger, marginBottom: 8 },
    addedNote: { color: colors.accent, textAlign: 'center', marginTop: 12 },
  });
}
