import React, { useCallback, useEffect, useState } from 'react';
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
import { addToWatchlist, getWatchlist, removeFromWatchlist } from '../db/database';
import { fetchHistory, fetchQuote, searchSymbols, type SymbolSearchResult } from '../api/marketData';
import { computeSignal } from '../signals/signalEngine';
import { checkAlertsForSymbol } from '../notifications/alertEngine';
import type { Quote, Signal } from '../types';
import { SignalBadge } from '../components/SignalBadge';

type Props = NativeStackScreenProps<WatchlistStackParamList, 'Watchlist'>;

type Row = {
  symbol: string;
  quote?: Quote;
  signal?: Signal;
  error?: string;
};

export function WatchlistScreen({ navigation }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [adding, setAdding] = useState(false);
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

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
    }, [load])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
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
              <Ionicons name="add-circle-outline" size={20} color="#0a7d32" />
            </Pressable>
          ))}
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.symbol}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={({ item }) => (
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
                  <Text style={[styles.change, { color: item.quote.change >= 0 ? '#0a7d32' : '#c0392b' }]}>
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
                <Ionicons name="trash-outline" size={18} color="#c0392b" />
              </Pressable>
              <Ionicons name="chevron-forward" size={18} color="#bbb" />
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="telescope-outline" size={28} color="#bbb" />
              <Text style={styles.emptyText}>Search above to start tracking a stock.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  addRow: { flexDirection: 'row', marginBottom: 8, gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0a7d32',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  addButtonText: { color: '#fff', fontWeight: '600' },
  searchResults: {
    backgroundColor: '#f5f5f5',
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
    borderBottomColor: '#ddd',
    gap: 8,
  },
  searchSymbol: { fontWeight: '700' },
  searchName: { color: '#666', fontSize: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
    gap: 10,
  },
  symbol: { fontSize: 16, fontWeight: '700' },
  change: { fontSize: 13, marginTop: 2 },
  error: { fontSize: 13, color: '#c0392b', marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 40, gap: 8 },
  emptyText: { color: '#888' },
});
