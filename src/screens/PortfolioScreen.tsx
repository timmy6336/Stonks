import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PortfolioStackParamList } from '../navigation/types';
import { getActiveProfile, getPositions, getTrades, resetPaperAccount } from '../db/database';
import { fetchQuote } from '../api/marketData';
import type { Position, Profile, Trade } from '../types';

type PositionRow = Position & { currentPrice?: number };
type Props = NativeStackScreenProps<PortfolioStackParamList, 'Portfolio'>;

export function PortfolioScreen({ navigation }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [activeProfile, pos, tradeHistory] = await Promise.all([
      getActiveProfile(),
      getPositions(),
      getTrades('PAPER'),
    ]);
    setProfile(activeProfile);
    setTrades(tradeHistory);
    setPositions(pos);
    setLoading(false);

    await Promise.all(
      pos.map(async (p) => {
        try {
          const q = await fetchQuote(p.symbol);
          setPositions((prev) => prev.map((row) => (row.symbol === p.symbol ? { ...row, currentPrice: q.price } : row)));
        } catch {
          // leave currentPrice unset if the quote fails; UI shows cost basis only
        }
      })
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const cash = profile?.cashBalance ?? 0;
  const marketValue = positions.reduce((sum, p) => sum + (p.currentPrice ?? p.avgCost) * p.quantity, 0);
  const totalValue = cash + marketValue;

  const handleReset = () => {
    Alert.alert(
      'Reset this save?',
      `This clears all simulated positions and trade history and resets cash to $${(profile?.startingCash ?? 0).toFixed(2)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetPaperAccount();
            await load();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      data={positions}
      keyExtractor={(p) => p.symbol}
      ListHeaderComponent={
        <>
          <Pressable style={styles.saveRow} onPress={() => navigation.navigate('Profiles')}>
            <View style={styles.saveLabelRow}>
              <Ionicons name="albums" size={16} color="#333" />
              <Text style={styles.saveLabel}>Save: {profile?.name ?? ''}</Text>
            </View>
            <View style={styles.saveLabelRow}>
              <Text style={styles.saveManage}>Manage saves</Text>
              <Ionicons name="chevron-forward" size={16} color="#0a7d32" />
            </View>
          </Pressable>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total paper portfolio value</Text>
            <Text style={styles.summaryValue}>${totalValue.toFixed(2)}</Text>
            <Text style={styles.summarySub}>Cash: ${cash.toFixed(2)}   Invested: ${marketValue.toFixed(2)}</Text>
          </View>
          <View style={styles.sectionHeader}>
            <Ionicons name="pie-chart" size={16} color="#0a7d32" />
            <Text style={styles.sectionTitle}>Positions</Text>
          </View>
        </>
      }
      renderItem={({ item }) => {
        const pl = item.currentPrice !== undefined ? (item.currentPrice - item.avgCost) * item.quantity : undefined;
        return (
          <View style={styles.row}>
            <View>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <Text style={styles.sub}>{item.quantity} shares @ avg ${item.avgCost.toFixed(2)}</Text>
            </View>
            {pl !== undefined && (
              <Text style={{ color: pl >= 0 ? '#0a7d32' : '#c0392b', fontWeight: '600' }}>
                {pl >= 0 ? '+' : ''}${pl.toFixed(2)}
              </Text>
            )}
          </View>
        );
      }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="file-tray-outline" size={24} color="#bbb" />
          <Text style={styles.emptyText}>No open paper positions yet.</Text>
        </View>
      }
      ListFooterComponent={
        <>
          <View style={styles.sectionHeader}>
            <Ionicons name="receipt" size={16} color="#0a7d32" />
            <Text style={styles.sectionTitle}>Recent trades</Text>
          </View>
          {trades.slice(0, 20).map((t) => (
            <View key={t.id} style={styles.row}>
              <View style={styles.tradeRow}>
                <Ionicons
                  name={t.side === 'BUY' ? 'arrow-up-circle' : 'arrow-down-circle'}
                  size={16}
                  color={t.side === 'BUY' ? '#0a7d32' : '#c0392b'}
                />
                <Text>
                  {t.side} {t.quantity} {t.symbol} @ ${t.price.toFixed(2)}
                </Text>
              </View>
              <Text style={styles.sub}>{new Date(t.timestamp).toLocaleDateString()}</Text>
            </View>
          ))}
          <Pressable style={styles.resetButton} onPress={handleReset}>
            <Ionicons name="refresh" size={16} color="#c0392b" />
            <Text style={styles.resetText}>Reset this save</Text>
          </Pressable>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  saveRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  saveLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  saveLabel: { fontWeight: '700', fontSize: 15 },
  saveManage: { color: '#0a7d32', fontWeight: '600' },
  summaryCard: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 16, marginBottom: 16 },
  summaryLabel: { color: '#666' },
  summaryValue: { fontSize: 28, fontWeight: '700', marginTop: 4 },
  summarySub: { marginTop: 6, color: '#666' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  tradeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  symbol: { fontWeight: '700' },
  sub: { color: '#666', fontSize: 12, marginTop: 2 },
  empty: { alignItems: 'center', marginVertical: 12, gap: 6 },
  emptyText: { color: '#888' },
  resetButton: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 20, paddingVertical: 12, alignItems: 'center' },
  resetText: { color: '#c0392b', fontWeight: '600' },
});
