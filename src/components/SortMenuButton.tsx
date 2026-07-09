import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';
import type { Quote, Signal, SignalScore } from '../types';

export type SortMode = 'DEFAULT' | 'CHANGE_DESC' | 'CHANGE_ASC' | 'SIGNAL_DESC' | 'ALPHA';

const SIGNAL_RANK: Record<SignalScore, number> = {
  STRONG_BUY: 2,
  BUY: 1,
  HOLD: 0,
  SELL: -1,
  STRONG_SELL: -2,
};

const OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'DEFAULT', label: 'Default order' },
  { value: 'CHANGE_DESC', label: '% Change (high to low)' },
  { value: 'CHANGE_ASC', label: '% Change (low to high)' },
  { value: 'SIGNAL_DESC', label: 'Signal strength' },
  { value: 'ALPHA', label: 'Alphabetical' },
];

/** Sorts any row shape carrying a symbol + optional quote/signal, keeping still-loading rows in a stable spot. */
export function sortRows<T extends { symbol: string; quote?: Quote; signal?: Signal }>(rows: T[], mode: SortMode): T[] {
  if (mode === 'DEFAULT') return rows;
  const copy = [...rows];
  switch (mode) {
    case 'CHANGE_DESC':
      copy.sort((a, b) => (b.quote?.changePercent ?? -Infinity) - (a.quote?.changePercent ?? -Infinity));
      break;
    case 'CHANGE_ASC':
      copy.sort((a, b) => (a.quote?.changePercent ?? Infinity) - (b.quote?.changePercent ?? Infinity));
      break;
    case 'SIGNAL_DESC':
      copy.sort((a, b) => SIGNAL_RANK[b.signal?.score ?? 'HOLD'] - SIGNAL_RANK[a.signal?.score ?? 'HOLD']);
      break;
    case 'ALPHA':
      copy.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
  }
  return copy;
}

type Props = {
  value: SortMode;
  onChange: (value: SortMode) => void;
};

export function SortMenuButton({ value, onChange }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const currentLabel = OPTIONS.find((o) => o.value === value)?.label ?? 'Sort';

  return (
    <>
      <Pressable style={styles.button} onPress={() => setOpen(true)}>
        <Ionicons name="swap-vertical" size={14} color={colors.text} />
        <Text style={styles.buttonText} numberOfLines={1}>
          {currentLabel}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.menu}>
            {OPTIONS.map((o) => (
              <Pressable
                key={o.value}
                style={styles.menuItem}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <Ionicons
                  name={value === o.value ? 'radio-button-on' : 'radio-button-off'}
                  size={16}
                  color={value === o.value ? colors.accent : colors.textMuted}
                />
                <Text style={styles.menuItemText}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
      backgroundColor: colors.chipBackground,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 7,
      marginBottom: 8,
    },
    buttonText: { color: colors.text, fontSize: 13, fontWeight: '600', maxWidth: 160 },
    backdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'center', padding: 24 },
    menu: { backgroundColor: colors.card, borderRadius: 12, padding: 8 },
    menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 8 },
    menuItemText: { color: colors.text, fontSize: 14 },
  });
}
