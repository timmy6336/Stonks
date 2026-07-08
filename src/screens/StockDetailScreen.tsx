import React, { useCallback, useState } from 'react';
import { Dimensions, ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LineChart } from 'react-native-chart-kit';
import type { WatchlistStackParamList } from '../navigation/types';
import { fetchHistory, fetchQuote } from '../api/marketData';
import { computeSignal } from '../signals/signalEngine';
import { executeTrade, getActiveTradingMode } from '../trading/tradingService';
import { getPosition } from '../db/database';
import type { Candle, Position, Quote, Signal, TradingMode } from '../types';
import { SignalBadge } from '../components/SignalBadge';
import type { TradeSide } from '../types';

type Props = NativeStackScreenProps<WatchlistStackParamList, 'StockDetail'>;

export function StockDetailScreen({ route }: Props) {
  const { symbol } = route.params;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [mode, setMode] = useState<TradingMode>('PAPER');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tradeSide, setTradeSide] = useState<TradeSide | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, history, pos, activeMode] = await Promise.all([
        fetchQuote(symbol),
        fetchHistory(symbol, '6mo', '1d'),
        getPosition(symbol),
        getActiveTradingMode(),
      ]);
      setQuote(q);
      setCandles(history);
      setSignal(computeSignal(symbol, history));
      setPosition(pos);
      setMode(activeMode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openTrade = (side: TradeSide) => {
    setTradeSide(side);
    setQuantity('1');
    setTradeError(null);
  };

  const submitTrade = async () => {
    if (!tradeSide || !quote) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setTradeError('Enter a valid quantity.');
      return;
    }
    setSubmitting(true);
    setTradeError(null);
    try {
      await executeTrade(symbol, tradeSide, qty, quote.price);
      setTradeSide(null);
      await load();
    } catch (e) {
      setTradeError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !quote) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? 'Unable to load data.'}</Text>
      </View>
    );
  }

  const chartWidth = Dimensions.get('window').width - 32;
  const chartData = candles.filter((_, i) => i % Math.ceil(candles.length / 60 || 1) === 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.header}>
        <View>
          <Text style={styles.symbol}>{symbol}</Text>
          <Text style={styles.price}>${quote.price.toFixed(2)}</Text>
          <Text style={{ color: quote.change >= 0 ? '#0a7d32' : '#c0392b' }}>
            {quote.change >= 0 ? '+' : ''}
            {quote.change.toFixed(2)} ({quote.changePercent.toFixed(2)}%)
          </Text>
        </View>
        {signal && <SignalBadge score={signal.score} />}
      </View>

      {chartData.length > 1 && (
        <LineChart
          data={{ labels: [], datasets: [{ data: chartData.map((c) => c.close) }] }}
          width={chartWidth}
          height={200}
          withDots={false}
          withInnerLines={false}
          withHorizontalLabels
          withVerticalLabels={false}
          chartConfig={{
            backgroundGradientFrom: '#fff',
            backgroundGradientTo: '#fff',
            color: (opacity = 1) => `rgba(10, 125, 50, ${opacity})`,
            labelColor: () => '#333',
            decimalPlaces: 2,
          }}
          bezier
          style={{ marginVertical: 8, borderRadius: 12 }}
        />
      )}

      {signal && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Why this signal</Text>
          {signal.reasons.map((reason, i) => (
            <Text key={i} style={styles.reason}>
              • {reason}
            </Text>
          ))}
        </View>
      )}

      {position && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your position</Text>
          <Text>{position.quantity} shares @ avg ${position.avgCost.toFixed(2)}</Text>
          <Text style={{ color: quote.price >= position.avgCost ? '#0a7d32' : '#c0392b' }}>
            Unrealized P&L: ${((quote.price - position.avgCost) * position.quantity).toFixed(2)}
          </Text>
        </View>
      )}

      <Text style={styles.modeLabel}>Mode: {mode === 'LIVE' ? 'LIVE (real money)' : 'Paper (simulated)'}</Text>

      <View style={styles.actionRow}>
        <Pressable style={[styles.actionButton, styles.buy]} onPress={() => openTrade('BUY')}>
          <Text style={styles.actionText}>Buy</Text>
        </Pressable>
        <Pressable style={[styles.actionButton, styles.sell]} onPress={() => openTrade('SELL')}>
          <Text style={styles.actionText}>Sell</Text>
        </Pressable>
      </View>

      <Modal visible={tradeSide !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>
              {tradeSide} {symbol} {mode === 'LIVE' ? '(real order)' : '(simulated)'}
            </Text>
            <Text style={{ marginBottom: 8 }}>Price: ${quote.price.toFixed(2)}</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={quantity}
              onChangeText={setQuantity}
              placeholder="Quantity"
            />
            {tradeError && <Text style={styles.error}>{tradeError}</Text>}
            <View style={styles.actionRow}>
              <Pressable style={styles.actionButton} onPress={() => setTradeSide(null)}>
                <Text>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, tradeSide === 'BUY' ? styles.buy : styles.sell]}
                onPress={submitTrade}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionText}>Confirm</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  symbol: { fontSize: 22, fontWeight: '700' },
  price: { fontSize: 28, fontWeight: '600', marginTop: 4 },
  card: { backgroundColor: '#f5f5f5', borderRadius: 12, padding: 14, marginTop: 16 },
  cardTitle: { fontWeight: '700', marginBottom: 8 },
  reason: { marginBottom: 4, color: '#333' },
  modeLabel: { marginTop: 16, color: '#666', fontStyle: 'italic' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  actionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#e0e0e0',
  },
  buy: { backgroundColor: '#0a7d32' },
  sell: { backgroundColor: '#c0392b' },
  actionText: { color: '#fff', fontWeight: '700' },
  error: { color: '#c0392b', marginBottom: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 8 },
});
