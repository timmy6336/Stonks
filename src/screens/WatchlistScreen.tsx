import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { WatchlistStackParamList } from '../navigation/types';
import { addToWatchlist, getWatchlist, removeFromWatchlist } from '../db/database';
import { fetchHistory, fetchQuote } from '../api/marketData';
import { computeSignal } from '../signals/signalEngine';
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
  const [newSymbol, setNewSymbol] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const items = await getWatchlist();
    const initialRows: Row[] = items.map((i) => ({ symbol: i.symbol }));
    setRows(initialRows);
    setLoading(false);

    await Promise.all(
      items.map(async (item, index) => {
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

  const handleAdd = async () => {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;
    setAdding(true);
    try {
      await fetchQuote(symbol); // validates the symbol exists before saving
      await addToWatchlist(symbol);
      setNewSymbol('');
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
          placeholder="Add ticker (e.g. AAPL)"
          autoCapitalize="characters"
          value={newSymbol}
          onChangeText={setNewSymbol}
          onSubmitEditing={handleAdd}
        />
        <Pressable style={styles.addButton} onPress={handleAdd} disabled={adding}>
          {adding ? <ActivityIndicator color="#fff" /> : <Text style={styles.addButtonText}>Add</Text>}
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.symbol}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('StockDetail', { symbol: item.symbol })}
              onLongPress={() => handleRemove(item.symbol)}
            >
              <View>
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
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Add a ticker above to start tracking it.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  addRow: { flexDirection: 'row', marginBottom: 16, gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addButton: {
    backgroundColor: '#0a7d32',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  addButtonText: { color: '#fff', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  symbol: { fontSize: 16, fontWeight: '700' },
  change: { fontSize: 13, marginTop: 2 },
  error: { fontSize: 13, color: '#c0392b', marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 40, color: '#888' },
});
