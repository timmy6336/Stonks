import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  clearAlpacaCredentials,
  getAlpacaAccount,
  getAlpacaCredentials,
  isLiveTradingEnabled,
  saveAlpacaCredentials,
  setLiveTradingEnabled,
} from '../alpaca/alpacaClient';

export function SettingsScreen() {
  const [keyId, setKeyId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [hasCredentials, setHasCredentials] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const creds = await getAlpacaCredentials();
    setHasCredentials(!!creds);
    setLiveEnabled(await isLiveTradingEnabled());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSave = async () => {
    if (!keyId.trim() || !secretKey.trim()) {
      setStatusMessage('Enter both the API key ID and secret key.');
      return;
    }
    setSaving(true);
    setStatusMessage(null);
    try {
      await saveAlpacaCredentials({ keyId: keyId.trim(), secretKey: secretKey.trim() });
      setKeyId('');
      setSecretKey('');
      await load();
      setStatusMessage('Alpaca credentials saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    await clearAlpacaCredentials();
    await load();
    setStatusMessage('Alpaca credentials removed. Live trading disabled.');
  };

  const handleToggleLive = async (value: boolean) => {
    if (!value) {
      await setLiveTradingEnabled(false);
      setLiveEnabled(false);
      return;
    }
    if (!hasCredentials) {
      Alert.alert('Add Alpaca credentials first', 'Save your Alpaca API key and secret above before enabling live trading.');
      return;
    }
    Alert.alert(
      'Enable real-money trading?',
      'Buy and sell actions will place real orders through your Alpaca account using real money. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Enable live trading',
          style: 'destructive',
          onPress: async () => {
            try {
              await getAlpacaAccount(); // verifies the credentials actually work before flipping the switch
              await setLiveTradingEnabled(true);
              setLiveEnabled(true);
            } catch (e) {
              Alert.alert('Could not verify Alpaca account', (e as Error).message);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.sectionTitle}>Alpaca API credentials</Text>
      <Text style={styles.helpText}>
        Create a free Alpaca account at alpaca.markets to get API keys for paper or live trading. Your keys are stored only
        on this device.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="API Key ID"
        autoCapitalize="none"
        value={keyId}
        onChangeText={setKeyId}
      />
      <TextInput
        style={styles.input}
        placeholder="API Secret Key"
        autoCapitalize="none"
        secureTextEntry
        value={secretKey}
        onChangeText={setSecretKey}
      />
      <Pressable style={styles.saveButton} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save credentials'}</Text>
      </Pressable>

      <Text style={styles.credentialStatus}>
        {hasCredentials ? 'Alpaca credentials are saved on this device.' : 'No Alpaca credentials saved yet.'}
      </Text>

      {hasCredentials && (
        <Pressable onPress={handleClear}>
          <Text style={styles.clearLink}>Remove saved credentials</Text>
        </Pressable>
      )}

      <View style={styles.divider} />

      <View style={styles.liveRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Live trading (real money)</Text>
          <Text style={styles.helpText}>
            When off, Buy/Sell everywhere in the app uses the built-in paper simulator — no account needed. When on, they
            place real orders through your Alpaca account.
          </Text>
        </View>
        <Switch value={liveEnabled} onValueChange={handleToggleLive} />
      </View>

      {statusMessage && <Text style={styles.status}>{statusMessage}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  helpText: { color: '#666', marginBottom: 12, lineHeight: 18 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 10 },
  saveButton: { backgroundColor: '#0a7d32', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontWeight: '700' },
  credentialStatus: { marginTop: 12, color: '#333' },
  clearLink: { color: '#c0392b', marginTop: 8 },
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 24 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  status: { marginTop: 16, color: '#0a7d32' },
});
