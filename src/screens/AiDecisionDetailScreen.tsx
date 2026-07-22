import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PortfolioStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';

type Props = NativeStackScreenProps<PortfolioStackParamList, 'AiDecisionDetail'>;

export function AiDecisionDetailScreen({ route }: Props) {
  const { round, profileName, riskLevel } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const executedCount = round.actions.filter((a) => a.executed).length;
  const skippedCount = round.actions.length - executedCount;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Ionicons name="sparkles" size={18} color={colors.accent} />
          <Text style={styles.headerTitle}>{profileName}</Text>
          <View style={styles.riskBadge}>
            <Text style={styles.riskBadgeText}>{riskLevel} RISK</Text>
          </View>
        </View>
        <Text style={styles.timestamp}>{new Date(round.timestamp).toLocaleString()}</Text>
        <Text style={styles.summary}>{round.summary}</Text>
        <View style={styles.countRow}>
          <View style={styles.countPill}>
            <Ionicons name="list" size={13} color={colors.text} />
            <Text style={styles.countPillText}>{round.actions.length} proposed</Text>
          </View>
          <View style={[styles.countPill, { backgroundColor: colors.accent }]}>
            <Ionicons name="checkmark-circle" size={13} color="#fff" />
            <Text style={[styles.countPillText, { color: '#fff' }]}>{executedCount} executed</Text>
          </View>
          {skippedCount > 0 && (
            <View style={[styles.countPill, { backgroundColor: colors.danger }]}>
              <Ionicons name="close-circle" size={13} color="#fff" />
              <Text style={[styles.countPillText, { color: '#fff' }]}>{skippedCount} skipped</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Ionicons name="swap-horizontal" size={16} color={colors.accent} />
        <Text style={styles.sectionTitle}>Actions</Text>
      </View>

      {round.actions.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.noActionsText}>No trades were proposed this round.</Text>
        </View>
      ) : (
        round.actions.map((a, i) => {
          const estimatedTotal = a.price != null ? a.price * a.quantity : null;
          return (
            <View key={i} style={styles.actionCard}>
              <View style={styles.actionHeaderRow}>
                <View
                  style={[
                    styles.actionTypeBadge,
                    { backgroundColor: a.action === 'BUY' ? colors.accent : colors.danger },
                  ]}
                >
                  <Ionicons name={a.action === 'BUY' ? 'arrow-up-circle' : 'arrow-down-circle'} size={13} color="#fff" />
                  <Text style={styles.actionTypeBadgeText}>{a.action}</Text>
                </View>
                <Text style={styles.actionSymbol}>{a.symbol}</Text>
                <View style={styles.actionStatusRow}>
                  <Ionicons
                    name={a.executed ? 'checkmark-circle' : 'close-circle'}
                    size={16}
                    color={a.executed ? colors.accent : colors.danger}
                  />
                  <Text style={[styles.actionStatusText, { color: a.executed ? colors.accent : colors.danger }]}>
                    {a.executed ? 'Executed' : 'Skipped'}
                  </Text>
                </View>
              </View>

              <View style={styles.actionDetailGrid}>
                <View style={styles.actionDetailItem}>
                  <Text style={styles.actionDetailLabel}>Quantity</Text>
                  <Text style={styles.actionDetailValue}>{a.quantity} sh</Text>
                </View>
                {a.price != null && (
                  <View style={styles.actionDetailItem}>
                    <Text style={styles.actionDetailLabel}>Price at decision</Text>
                    <Text style={styles.actionDetailValue}>${a.price.toFixed(2)}</Text>
                  </View>
                )}
                {estimatedTotal != null && (
                  <View style={styles.actionDetailItem}>
                    <Text style={styles.actionDetailLabel}>{a.action === 'BUY' ? 'Cost' : 'Proceeds'}</Text>
                    <Text style={styles.actionDetailValue}>${estimatedTotal.toFixed(2)}</Text>
                  </View>
                )}
              </View>

              <Text style={styles.actionReasoningLabel}>Reasoning</Text>
              <Text style={styles.actionReasoning}>{a.reasoning || '(none given)'}</Text>

              {!a.executed && a.error && (
                <>
                  <Text style={styles.actionReasoningLabel}>Why it was skipped</Text>
                  <View style={styles.errorBox}>
                    <Ionicons name="warning-outline" size={14} color={colors.danger} />
                    <Text style={styles.errorText}>{a.error}</Text>
                  </View>
                </>
              )}
            </View>
          );
        })
      )}

      <View style={styles.sectionHeader}>
        <Ionicons name="document-text-outline" size={16} color={colors.accent} />
        <Text style={styles.sectionTitle}>Raw AI response</Text>
      </View>
      <Text style={styles.rawHint}>Exactly what the AI provider returned this round, before parsing — useful for seeing why it made a call, or why parsing failed.</Text>
      <View style={styles.rawBox}>
        <Text style={styles.rawText} selectable>
          {round.rawResponse ?? '(no response was recorded — the round was skipped before calling the AI provider)'}
        </Text>
      </View>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerCard: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 16 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text, flex: 1 },
    riskBadge: { backgroundColor: colors.chipBackground, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    riskBadgeText: { color: colors.text, fontSize: 10, fontWeight: '700', includeFontPadding: false },
    timestamp: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
    summary: { color: colors.text, marginTop: 10, lineHeight: 20 },
    countRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
    countPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.chipBackground,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    countPillText: { color: colors.text, fontSize: 11, fontWeight: '600', includeFontPadding: false },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 16 },
    noActionsText: { color: colors.textMuted, fontStyle: 'italic' },
    actionCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 12 },
    actionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    actionTypeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    actionTypeBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', includeFontPadding: false },
    actionSymbol: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 },
    actionStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    actionStatusText: { fontSize: 12, fontWeight: '700', includeFontPadding: false },
    actionDetailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 10 },
    actionDetailItem: { minWidth: 80 },
    actionDetailLabel: { color: colors.textMuted, fontSize: 11 },
    actionDetailValue: { color: colors.text, fontWeight: '700', fontSize: 14, marginTop: 2 },
    actionReasoningLabel: { color: colors.textMuted, fontSize: 11, marginTop: 4, marginBottom: 2 },
    actionReasoning: { color: colors.text, lineHeight: 19 },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      backgroundColor: colors.chipBackground,
      borderRadius: 8,
      padding: 8,
      marginTop: 2,
    },
    errorText: { color: colors.danger, fontSize: 12, flex: 1, lineHeight: 17 },
    rawHint: { color: colors.textMuted, fontSize: 12, marginBottom: 8, lineHeight: 17 },
    rawBox: { backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 24 },
    rawText: { color: colors.textSecondary, fontFamily: 'monospace', fontSize: 12, lineHeight: 17 },
  });
}
