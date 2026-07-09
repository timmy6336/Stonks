import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { WatchlistStackParamList } from '../navigation/types';
import { addToWatchlist, getPositions, getWatchlist, logSignalIfNew, removeFromWatchlist } from '../db/database';
import { fetchHistory, fetchQuote, searchSymbols, type SymbolSearchResult } from '../api/marketData';
import { computeSignal } from '../signals/signalEngine';
import { checkAlertsForSymbol } from '../notifications/alertEngine';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';
import type { Position, Quote, Signal } from '../types';
import { SignalBadge } from '../components/SignalBadge';
import { matchesSignalFilter, SignalFilterRow, type SignalFilter } from '../components/SignalFilterRow';
import { sortRows, SortMenuButton, type SortMode } from '../components/SortMenuButton';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { hapticSuccess, hapticTap } from '../haptics/haptics';

type Props = NativeStackScreenProps<WatchlistStackParamList, 'Watchlist'>;

type Row = {
  symbol: string;
  quote?: Quote;
  signal?: Signal;
  error?: string;
};

type Holding = Position & {
  quote?: Quote;
  error?: string;
};

export function WatchlistScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [adding, setAdding] = useState(false);
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('DEFAULT');
  const [holdings, setHoldings] = useState<Holding[]>([]);

  const loadHoldings = useCallback(async () => {
    const positions = await getPositions();
    setHoldings(positions.map((p) => ({ ...p })));

    await Promise.all(
      positions.map(async (p) => {
        try {
          const quote = await fetchQuote(p.symbol);
          setHoldings((prev) => prev.map((h) => (h.symbol === p.symbol ? { ...p, quote } : h)));
        } catch (e) {
          setHoldings((prev) => prev.map((h) => (h.symbol === p.symbol ? { ...p, error: (e as Error).message } : h)));
        }
      })
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const items = await getWatchlist();
    const initialRows: Row[] = items.map((i) => ({ symbol: i.symbol }));
    setRows(initialRows);
    setLoading(false);

    await Promise.all(
      items.map(async (item) => {
        try {
          const [quote, history] = await Promise.all([
            fetchQuote(item.symbol),
            fetchHistory(item.symbol, '6mo', '1d'),
          ]);
          const signal = computeSignal(item.symbol, history);
          logSignalIfNew(item.symbol, signal.score, signal.points, quote.price).catch(() => {}); // best-effort track record logging
          setRows((prev) => {
            const next = [...prev];
            const idx = next.findIndex((r) => r.symbol === item.symbol);
            if (idx !== -1) next[idx] = { symbol: item.symbol, quote, signal };
            return next;
          });
          checkAlertsForSymbol(item.symbol, quote, signal).catch(() => {}); // best-effort; never block the list on it
        } catch (e) {
          setRows((prev) => {
            const next = [...prev];
            const idx = next.findIndex((r) => r.symbol === item.symbol);
            if (idx !== -1) next[idx] = { symbol: item.symbol, error: (e as Error).message };
            return next;
          });
        }
      })
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      loadHoldings();
    }, [load, loadHoldings])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), loadHoldings()]);
    setRefreshing(false);
  };

  // Debounced company-name/ticker search so users don't need to know the exact symbol.
  useEffect(() => {
    const query = newSymbol.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchSymbols(query);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [newSymbol]);

  const handleAddSymbol = async (symbol: string) => {
    setAdding(true);
    try {
      await addToWatchlist(symbol);
      hapticSuccess();
      setNewSymbol('');
      setSearchResults([]);
      await load();
    } finally {
      setAdding(false);
    }
  };

  const handleAdd = async () => {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;
    setAdding(true);
    try {
      await fetchQuote(symbol); // validates the symbol exists before saving
      await addToWatchlist(symbol);
      hapticSuccess();
      setNewSymbol('');
      setSearchResults([]);
      await load();
    } catch (e) {
      setRows((prev) => [...prev, { symbol, error: `Could not find symbol "${symbol}"` }]);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (symbol: string) => {
    hapticTap();
    await removeFromWatchlist(symbol);
    await load();
  };

  return (
    <View style={styles.container}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="Search company or ticker"
          autoCapitalize="none"
          value={newSymbol}
          onChangeText={setNewSymbol}
          onSubmitEditing={handleAdd}
        />
        <Pressable style={styles.addButton} onPress={handleAdd} disabled={adding}>
          {adding ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="add-circle" size={16} color="#fff" />
              <Text style={styles.addButtonText}>Add</Text>
            </>
          )}
        </Pressable>
      </View>

      {searching && <ActivityIndicator size="small" style={{ marginBottom: 8 }} />}
      {searchResults.length > 0 && (
        <View style={styles.searchResults}>
          {searchResults.map((r) => (
            <Pressable key={r.symbol} style={styles.searchRow} onPress={() => handleAddSymbol(r.symbol)}>
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

      {holdings.length > 0 && (
        <View style={styles.holdingsSection}>
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="briefcase" size={16} color={colors.accent} />
            <Text style={styles.sectionTitle}>Your holdings</Text>
          </View>
          {holdings.map((h) => {
            const value = h.quote ? h.quote.price * h.quantity : null;
            const pnl = h.quote ? (h.quote.price - h.avgCost) * h.quantity : null;
            const pnlPercent = h.quote && h.avgCost !== 0 ? ((h.quote.price - h.avgCost) / h.avgCost) * 100 : null;
            return (
              <Pressable
                key={h.symbol}
                style={styles.holdingRow}
                onPress={() => navigation.navigate('StockDetail', { symbol: h.symbol })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.symbol}>{h.symbol}</Text>
                  <Text style={styles.holdingMeta}>
                    {h.quantity} sh @ avg ${h.avgCost.toFixed(2)}
                  </Text>
                </View>
                {h.error ? (
                  <Text style={styles.error}>{h.error}</Text>
                ) : value !== null && pnl !== null && pnlPercent !== null ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.holdingValue}>${value.toFixed(2)}</Text>
                    <Text style={[styles.change, { color: pnl >= 0 ? colors.accent : colors.danger }]}>
                      {pnl >= 0 ? '+' : ''}
                      {pnl.toFixed(2)} ({pnlPercent >= 0 ? '+' : ''}
                      {pnlPercent.toFixed(1)}%)
                    </Text>
                  </View>
                ) : (
                  <ActivityIndicator size="small" />
                )}
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            );
          })}
        </View>
      )}

      {rows.length > 0 && (
        <>
          <SignalFilterRow value={signalFilter} onChange={setSignalFilter} />
          <SortMenuButton value={sortMode} onChange={setSortMode} />
        </>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={sortRows(rows.filter((r) => matchesSignalFilter(r.signal?.score, signalFilter)), sortMode)}
          keyExtractor={(r) => r.symbol}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={({ item }) => (
            <SwipeToDelete onDelete={() => handleRemove(item.symbol)}>
              <Pressable
                style={styles.row}
                onPress={() => navigation.navigate('StockDetail', { symbol: item.symbol })}
                onLongPress={() => handleRemove(item.symbol)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.symbol}>{item.symbol}</Text>
                  {item.error ? (
                    <Text style={styles.error}>{item.error}</Text>
                  ) : item.quote ? (
                    <Text style={[styles.change, { color: item.quote.change >= 0 ? colors.accent : colors.danger }]}>
                      ${item.quote.price.toFixed(2)} ({item.quote.change >= 0 ? '+' : ''}
                      {item.quote.changePercent.toFixed(2)}%)
                    </Text>
                  ) : (
                    <ActivityIndicator size="small" />
                  )}
                </View>
                {item.signal && <SignalBadge score={item.signal.score} />}
                <Pressable
                  hitSlop={8}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleRemove(item.symbol);
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            </SwipeToDelete>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="telescope-outline" size={28} color={colors.textMuted} />
              <Text style={styles.emptyText}>
                {rows.length === 0 ? 'Search above to start tracking a stock.' : 'No stocks match this filter.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: colors.background },
    addRow: { flexDirection: 'row', marginBottom: 8, gap: 8 },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: colors.text,
      backgroundColor: colors.inputBackground,
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 16,
      justifyContent: 'center',
    },
    addButtonText: { color: '#fff', fontWeight: '600' },
    searchResults: {
      backgroundColor: colors.card,
      borderRadius: 8,
      marginBottom: 12,
      overflow: 'hidden',
    },
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
    holdingsSection: { backgroundColor: colors.card, borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, paddingBottom: 6 },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    holdingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    holdingMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    holdingValue: { color: colors.text, fontWeight: '700' },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 10,
    },
    symbol: { fontSize: 16, fontWeight: '700', color: colors.text },
    change: { fontSize: 13, marginTop: 2 },
    error: { fontSize: 13, color: colors.danger, marginTop: 2 },
    empty: { alignItems: 'center', marginTop: 40, gap: 8 },
    emptyText: { color: colors.textMuted },
  });
}
