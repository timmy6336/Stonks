import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SignalBadge } from './SignalBadge';
import type { TickerRowData } from '../hooks/useTickerRows';

type Props = {
  row: TickerRowData;
  onPress: (symbol: string) => void;
  onAddToWatchlist?: (symbol: string) => void;
};

export function TickerRow({ row, onPress, onAddToWatchlist }: Props) {
  return (
    <Pressable style={styles.row} onPress={() => onPress(row.symbol)}>
      <View style={{ flex: 1 }}>
        <Text style={styles.symbol}>{row.symbol}</Text>
        {row.error ? (
          <Text style={styles.error}>{row.error}</Text>
        ) : row.quote ? (
          <Text style={[styles.change, { color: row.quote.change >= 0 ? '#0a7d32' : '#c0392b' }]}>
            ${row.quote.price.toFixed(2)} ({row.quote.change >= 0 ? '+' : ''}
            {row.quote.changePercent.toFixed(2)}%)
          </Text>
        ) : (
          <ActivityIndicator size="small" />
        )}
      </View>
      {row.signal && <SignalBadge score={row.signal.score} />}
      {onAddToWatchlist && (
        <Pressable
          style={styles.addButton}
          onPress={(e) => {
            e.stopPropagation();
            onAddToWatchlist(row.symbol);
          }}
        >
          <Ionicons name="bookmark-outline" size={14} color="#333" />
          <Text style={styles.addButtonText}>Watch</Text>
        </Pressable>
      )}
      <Ionicons name="chevron-forward" size={18} color="#bbb" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  addButtonText: { color: '#333', fontSize: 12, fontWeight: '600' },
});
