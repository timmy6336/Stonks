import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert as RNAlert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { deleteAlert, getAlerts, resetAlert } from '../db/database';
import type { Alert, AlertType } from '../types';

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  PRICE_ABOVE: 'Price above',
  PRICE_BELOW: 'Price below',
  SIGNAL_BUY_OR_BETTER: 'Signal reaches BUY',
  SIGNAL_STRONG_BUY: 'Signal reaches STRONG BUY',
};

function describeAlert(alert: Alert): string {
  const label = ALERT_TYPE_LABELS[alert.type];
  return alert.threshold != null ? `${label} $${alert.threshold.toFixed(2)}` : label;
}

export function AlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setAlerts(await getAlerts());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleDelete = (alert: Alert) => {
    RNAlert.alert('Delete this alert?', `${alert.symbol} - ${describeAlert(alert)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteAlert(alert.id);
          await load();
        },
      },
    ]);
  };

  const handleReset = async (alert: Alert) => {
    await resetAlert(alert.id);
    await load();
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
      data={alerts}
      keyExtractor={(a) => String(a.id)}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.symbol}>{item.symbol}</Text>
            <Text style={styles.description}>{describeAlert(item)}</Text>
            {item.triggeredAt && (
              <Text style={styles.triggered}>Triggered {new Date(item.triggeredAt).toLocaleString()}</Text>
            )}
          </View>
          {item.triggeredAt && (
            <Pressable hitSlop={8} onPress={() => handleReset(item)}>
              <Ionicons name="refresh-circle-outline" size={22} color="#0a7d32" />
            </Pressable>
          )}
          <Pressable hitSlop={8} onPress={() => handleDelete(item)}>
            <Ionicons name="trash-outline" size={20} color="#c0392b" />
          </Pressable>
        </View>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="notifications-outline" size={28} color="#bbb" />
          <Text style={styles.emptyText}>
            No alerts yet. Open a stock's detail page and tap "Set alert" to create one.
          </Text>
        </View>
      }
      ListFooterComponent={
        alerts.length > 0 ? (
          <Text style={styles.hint}>
            Alerts only fire while the app is open (foreground or just launched) — there's no backend server to push
            them while the app is closed.
          </Text>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  symbol: { fontWeight: '700', fontSize: 15 },
  description: { color: '#666', fontSize: 13, marginTop: 2 },
  triggered: { color: '#0a7d32', fontSize: 11, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 40, gap: 8, paddingHorizontal: 24 },
  emptyText: { color: '#888', textAlign: 'center' },
  hint: { color: '#999', fontSize: 11, textAlign: 'center', marginTop: 16, paddingHorizontal: 8 },
});
