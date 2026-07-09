import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/types';
import {
  clearAlpacaCredentials,
  getAlpacaAccount,
  getAlpacaCredentials,
  isLiveTradingEnabled,
  saveAlpacaCredentials,
  setLiveTradingEnabled,
} from '../alpaca/alpacaClient';
import {
  clearProviderApiKey,
  getActiveProviderId,
  hasProviderApiKey,
  saveProviderApiKey,
  setActiveProviderId,
} from '../llm/llmClient';
import { LLM_PROVIDERS, type LLMProviderId } from '../llm/providers';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';

type Props = NativeStackScreenProps<SettingsStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [keyId, setKeyId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [hasCredentials, setHasCredentials] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [providerKeyInputs, setProviderKeyInputs] = useState<Record<LLMProviderId, string>>(
    Object.fromEntries(LLM_PROVIDERS.map((p) => [p.id, ''])) as Record<LLMProviderId, string>
  );
  const [providerHasKey, setProviderHasKey] = useState<Record<LLMProviderId, boolean>>(
    Object.fromEntries(LLM_PROVIDERS.map((p) => [p.id, false])) as Record<LLMProviderId, boolean>
  );
  const [activeProviderId, setActiveProviderIdState] = useState<LLMProviderId | null>(null);
  const [savingProviderId, setSavingProviderId] = useState<LLMProviderId | null>(null);

  const load = useCallback(async () => {
    const creds = await getAlpacaCredentials();
    setHasCredentials(!!creds);
    setLiveEnabled(await isLiveTradingEnabled());
    const keyChecks = await Promise.all(LLM_PROVIDERS.map((p) => hasProviderApiKey(p.id)));
    setProviderHasKey(Object.fromEntries(LLM_PROVIDERS.map((p, i) => [p.id, keyChecks[i]])) as Record<LLMProviderId, boolean>);
    setActiveProviderIdState(await getActiveProviderId());
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

  const handleSaveProviderKey = async (id: LLMProviderId) => {
    const value = providerKeyInputs[id].trim();
    if (!value) {
      setStatusMessage('Enter an API key.');
      return;
    }
    setSavingProviderId(id);
    try {
      await saveProviderApiKey(id, value);
      setProviderKeyInputs((prev) => ({ ...prev, [id]: '' }));
      await load();
      setStatusMessage(`${LLM_PROVIDERS.find((p) => p.id === id)!.name} API key saved.`);
    } finally {
      setSavingProviderId(null);
    }
  };

  const handleClearProviderKey = async (id: LLMProviderId) => {
    await clearProviderApiKey(id);
    await load();
    setStatusMessage(`${LLM_PROVIDERS.find((p) => p.id === id)!.name} API key removed.`);
  };

  const handleUseProvider = async (id: LLMProviderId) => {
    await setActiveProviderId(id);
    await load();
    setStatusMessage(`${LLM_PROVIDERS.find((p) => p.id === id)!.name} is now your active AI provider.`);
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
        <Ionicons name="key" size={16} color={colors.accent} />
        <Text style={styles.sectionTitle}>Alpaca API credentials</Text>
      </View>
      <Text style={styles.helpText}>
        Create a free Alpaca account at alpaca.markets to get API keys for paper or live trading. Your keys are stored only
        on this device.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="API Key ID"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        value={keyId}
        onChangeText={setKeyId}
      />
      <TextInput
        style={styles.input}
        placeholder="API Secret Key"
        placeholderTextColor={colors.textMuted}
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
          color={hasCredentials ? colors.accent : colors.textMuted}
        />
        <Text style={styles.credentialStatus}>
          {hasCredentials ? 'Alpaca credentials are saved on this device.' : 'No Alpaca credentials saved yet.'}
        </Text>
      </View>

      {hasCredentials && (
        <Pressable style={styles.clearLinkRow} onPress={handleClear}>
          <Ionicons name="trash-outline" size={14} color={colors.danger} />
          <Text style={styles.clearLink}>Remove saved credentials</Text>
        </Pressable>
      )}

      <View style={styles.divider} />

      <View style={styles.liveRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.sectionHeader}>
            <Ionicons name="flash" size={16} color={colors.accent} />
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
        <Ionicons name="sparkles" size={16} color={colors.accent} />
        <Text style={styles.sectionTitle}>AI insights (optional)</Text>
      </View>
      <Text style={styles.helpText}>
        Add your own API key from any of these providers to get an AI-generated take on any stock's detail page.
        Keys are stored only on this device; more providers can be added later. If you save more than one, the
        first one you save becomes active — tap "Use this" on another to switch.
      </Text>
      {LLM_PROVIDERS.map((provider) => {
        const isActive = activeProviderId === provider.id;
        const hasKey = providerHasKey[provider.id];
        return (
          <View key={provider.id} style={styles.providerCard}>
            <View style={styles.providerHeaderRow}>
              <Text style={styles.providerName}>{provider.name}</Text>
              {isActive && (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>ACTIVE</Text>
                </View>
              )}
            </View>
            <Text style={styles.providerNote}>{provider.freeTierNote}</Text>
            <Pressable style={styles.linkRow} onPress={() => Linking.openURL(provider.apiKeyUrl)}>
              <Ionicons name="open-outline" size={14} color={colors.accent} />
              <Text style={styles.link}>Get a free {provider.name} API key</Text>
            </Pressable>

            {hasKey ? (
              <>
                <View style={styles.credentialStatusRow}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.accent} />
                  <Text style={styles.credentialStatus}>API key saved on this device.</Text>
                </View>
                <View style={styles.providerActionRow}>
                  {!isActive && (
                    <Pressable style={styles.useButton} onPress={() => handleUseProvider(provider.id)}>
                      <Text style={styles.useButtonText}>Use this</Text>
                    </Pressable>
                  )}
                  <Pressable style={styles.clearLinkRow} onPress={() => handleClearProviderKey(provider.id)}>
                    <Ionicons name="trash-outline" size={14} color={colors.danger} />
                    <Text style={styles.clearLink}>Remove key</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder={`${provider.name} API key`}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  secureTextEntry
                  value={providerKeyInputs[provider.id]}
                  onChangeText={(text) => setProviderKeyInputs((prev) => ({ ...prev, [provider.id]: text }))}
                />
                <Pressable
                  style={styles.saveButton}
                  onPress={() => handleSaveProviderKey(provider.id)}
                  disabled={savingProviderId === provider.id}
                >
                  {savingProviderId === provider.id ? (
                    <Text style={styles.saveButtonText}>Saving…</Text>
                  ) : (
                    <>
                      <Ionicons name="save" size={16} color="#fff" />
                      <Text style={styles.saveButtonText}>Save key</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </View>
        );
      })}

      {statusMessage && (
        <View style={styles.statusRow}>
          <Ionicons name="checkmark-circle" size={14} color={colors.accent} />
          <Text style={styles.status}>{statusMessage}</Text>
        </View>
      )}

      <View style={styles.divider} />

      <View style={styles.sectionHeader}>
        <Ionicons name="information-circle" size={16} color={colors.accent} />
        <Text style={styles.sectionTitle}>More</Text>
      </View>
      <Pressable style={styles.navRow} onPress={() => navigation.navigate('HowItWorks')}>
        <Ionicons name="help-circle-outline" size={18} color={colors.text} />
        <Text style={styles.navRowText}>How this works</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>
      <Pressable style={styles.navRow} onPress={() => navigation.navigate('SignalTrackRecord')}>
        <Ionicons name="stats-chart-outline" size={18} color={colors.text} />
        <Text style={styles.navRowText}>Signal track record</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    helpText: { color: colors.textSecondary, marginBottom: 12, lineHeight: 18 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 10,
      marginBottom: 10,
      backgroundColor: colors.inputBackground,
      color: colors.text,
    },
    saveButton: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
    },
    saveButtonText: { color: '#fff', fontWeight: '700', includeFontPadding: false },
    credentialStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
    credentialStatus: { color: colors.text },
    clearLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
    clearLink: { color: colors.danger },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 24 },
    providerCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    providerHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    providerName: { fontSize: 15, fontWeight: '700', color: colors.text },
    activeBadge: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
    activeBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', includeFontPadding: false },
    providerNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 6 },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
    link: { color: colors.accent, fontSize: 13 },
    providerActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    useButton: { backgroundColor: colors.chipBackground, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    useButtonText: { color: colors.text, fontWeight: '600', fontSize: 12, includeFontPadding: false },
    liveRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
    status: { color: colors.accent },
    navRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    navRowText: { color: colors.text, flex: 1, fontWeight: '600' },
  });
}
