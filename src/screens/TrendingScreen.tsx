import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TrendingStackParamList } from '../navigation/types';
import { fetchScreener, fetchTrendingSymbols } from '../api/marketData';
import { addToWatchlist } from '../db/database';
import { useTickerRows } from '../hooks/useTickerRows';
import { TickerRow } from '../components/TickerRow';
import { STOCK_CATEGORIES } from '../data/categories';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';

type Props = NativeStackScreenProps<TrendingStackParamList, 'Trending'>;

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
      setOnSaleSymbols(await fetchScreener('day_losers', 15));
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
    setJustAdded(symbol);
  };

  const goToDetail = (symbol: string) => navigation.navigate('StockDetail', { symbol });

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadTrending(), loadOnSale(), trending.reload(), onSale.reload(), category.reload()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <View style={styles.sectionHeader}>
        <Ionicons name="flame" size={18} color={colors.accent} />
        <Text style={styles.sectionTitle}>Trending now</Text>
      </View>
      {trendingError && <Text style={styles.error}>{trendingError}</Text>}
      {trendingLoading && trending.rows.length === 0 ? (
        <ActivityIndicator style={{ marginVertical: 12 }} />
      ) : (
        trending.rows.map((row) => (
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
        onSale.rows.map((row) => (
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
            onPress={() => setSelectedCategoryId(c.id)}
          >
            <Ionicons name={c.icon} size={14} color={c.id === selectedCategoryId ? '#fff' : colors.text} />
            <Text style={[styles.chipText, c.id === selectedCategoryId && styles.chipTextSelected]}>{c.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {category.rows.map((row) => (
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
    chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    chipTextSelected: { color: '#fff' },
    error: { color: colors.danger, marginBottom: 8 },
    addedNote: { color: colors.accent, textAlign: 'center', marginTop: 12 },
  });
}
