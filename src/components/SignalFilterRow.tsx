import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/theme';
import type { SignalScore } from '../types';

export type SignalFilter = 'ALL' | SignalScore;

const FILTERS: { value: SignalFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'STRONG_BUY', label: 'Strong Buy' },
  { value: 'BUY', label: 'Buy' },
  { value: 'HOLD', label: 'Hold' },
  { value: 'SELL', label: 'Sell' },
  { value: 'STRONG_SELL', label: 'Strong Sell' },
];

type Props = {
  value: SignalFilter;
  onChange: (value: SignalFilter) => void;
};

export function SignalFilterRow({ value, onChange }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row}>
      {FILTERS.map((f) => (
        <Pressable
          key={f.value}
          style={[styles.chip, value === f.value && styles.chipSelected]}
          onPress={() => onChange(f.value)}
        >
          <Text style={[styles.chipText, value === f.value && styles.chipTextSelected]}>{f.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** True if a row (which may still be loading, i.e. no signal yet) should be visible under the given filter. */
export function matchesSignalFilter(score: SignalScore | undefined, filter: SignalFilter): boolean {
  if (filter === 'ALL') return true;
  if (score === undefined) return true; // keep loading placeholders visible regardless of filter
  return score === filter;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: { marginBottom: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 16,
      backgroundColor: colors.chipBackground,
      marginRight: 8,
    },
    chipSelected: { backgroundColor: colors.accent },
    chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    chipTextSelected: { color: '#fff' },
  });
}
