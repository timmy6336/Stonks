import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  clearAlpacaCredentials,
  getAlpacaAccount,
  getAlpacaCredentials,
  isLiveTradingEnabled,
  saveAlpacaCredentials,
  setLiveTradingEnabled,
} from '../alpaca/alpacaClient';
import { clearGeminiApiKey, hasGeminiApiKey, saveGeminiApiKey } from '../llm/llmClient';

export function SettingsScreen() {
  const [keyId, setKeyId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [hasCredentials, setHasCredentials] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [savingGemini, setSavingGemini] = useState(false);

  const load = useCallback(async () => {
    const creds = await getAlpacaCredentials();
    setHasCredentials(!!creds);
    setLiveEnabled(await isLiveTradingEnabled());
    setHasGeminiKey(await hasGeminiApiKey());
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

  const handleSaveGemini = async () => {
    if (!geminiKeyInput.trim()) {
      setStatusMessage('Enter a Gemini API key.');
      return;
    }
    setSavingGemini(true);
    try {
      await saveGeminiApiKey(geminiKeyInput.trim());
      setGeminiKeyInput('');
      await load();
      setStatusMessage('Gemini API key saved.');
    } finally {
      setSavingGemini(false);
    }
  };

  const handleClearGemini = async () => {
    await clearGeminiApiKey();
    await load();
    setStatusMessage('Gemini API key removed.');
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
      <View style={styles.sectionHeader}>
        <Ionicons name="key" size={16} color="#0a7d32" />
        <Text style={styles.sectionTitle}>Alpaca API credentials</Text>
      </View>
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
        {saving ? (
          <Text style={styles.saveButtonText}>Saving…</Text>
        ) : (
          <>
            <Ionicons name="save" size={16} color="#fff" />
            <Text style={styles.saveButtonText}>Save credentials</Text>
          </>
        )}
      </Pressable>

      <View style={styles.credentialStatusRow}>
        <Ionicons
          name={hasCredentials ? 'checkmark-circle' : 'alert-circle-outline'}
          size={14}
          color={hasCredentials ? '#0a7d32' : '#888'}
        />
        <Text style={styles.credentialStatus}>
          {hasCredentials ? 'Alpaca credentials are saved on this device.' : 'No Alpaca credentials saved yet.'}
        </Text>
      </View>

      {hasCredentials && (
        <Pressable style={styles.clearLinkRow} onPress={handleClear}>
          <Ionicons name="trash-outline" size={14} color="#c0392b" />
          <Text style={styles.clearLink}>Remove saved credentials</Text>
        </Pressable>
      )}

      <View style={styles.divider} />

      <View style={styles.liveRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.sectionHeader}>
            <Ionicons name="flash" size={16} color="#0a7d32" />
            <Text style={styles.sectionTitle}>Live trading (real money)</Text>
          </View>
          <Text style={styles.helpText}>
            When off, Buy/Sell everywhere in the app uses the built-in paper simulator — no account needed. When on, they
            place real orders through your Alpaca account.
          </Text>
        </View>
        <Switch value={liveEnabled} onValueChange={handleToggleLive} />
      </View>

      <View style={styles.divider} />

      <View style={styles.sectionHeader}>
        <Ionicons name="sparkles" size={16} color="#0a7d32" />
        <Text style={styles.sectionTitle}>AI insights (optional)</Text>
      </View>
      <Text style={styles.helpText}>
        Add your own free Gemini API key (from Google AI Studio, aistudio.google.com) to get an AI-generated take on
        any stock's detail page. Stored only on this device; never sent anywhere but Google's API.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Gemini API key"
        autoCapitalize="none"
        secureTextEntry
        value={geminiKeyInput}
        onChangeText={setGeminiKeyInput}
      />
      <Pressable style={styles.saveButton} onPress={handleSaveGemini} disabled={savingGemini}>
        {savingGemini ? (
          <Text style={styles.saveButtonText}>Saving…</Text>
        ) : (
          <>
            <Ionicons name="save" size={16} color="#fff" />
            <Text style={styles.saveButtonText}>Save Gemini key</Text>
          </>
        )}
      </Pressable>
      <View style={styles.credentialStatusRow}>
        <Ionicons
          name={hasGeminiKey ? 'checkmark-circle' : 'alert-circle-outline'}
          size={14}
          color={hasGeminiKey ? '#0a7d32' : '#888'}
        />
        <Text style={styles.credentialStatus}>
          {hasGeminiKey ? 'Gemini API key is saved on this device.' : 'No Gemini API key saved yet.'}
        </Text>
      </View>
      {hasGeminiKey && (
        <Pressable style={styles.clearLinkRow} onPress={handleClearGemini}>
          <Ionicons name="trash-outline" size={14} color="#c0392b" />
          <Text style={styles.clearLink}>Remove saved key</Text>
        </Pressable>
      )}

      {statusMessage && (
        <View style={styles.statusRow}>
          <Ionicons name="checkmark-circle" size={14} color="#0a7d32" />
          <Text style={styles.status}>{statusMessage}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  helpText: { color: '#666', marginBottom: 12, lineHeight: 18 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 10 },
  saveButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0a7d32',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonText: { color: '#fff', fontWeight: '700' },
  credentialStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  credentialStatus: { color: '#333' },
  clearLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  clearLink: { color: '#c0392b' },
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 24 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  status: { color: '#0a7d32' },
});
